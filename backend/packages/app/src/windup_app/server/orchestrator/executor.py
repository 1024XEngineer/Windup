"""动作生成后台编排(调 ai_engine)。

编排链:``短 session 标 RUNNING → 取母版 → ai_engine 出帧 → IO 池并行上传
(与判官重叠) → 短 session 写回 COMPLETED``。异常兜底为 FAILED,不抛。
生成期间不占 Postgres 连接,以便 worker 同时跑多路用户任务。

**分层**:本模块调 ai_engine,故 web/worker **不得 import 本模块**(否则牵出 ai_engine,
违反"入口层不经 ai_engine 直连"门禁)。由 bootstrap(composition root)import + 注入
``app.state``,web 端从 ``request.app.state`` 运行期取回调度,不产生静态依赖。

依赖(generator / upload / 取母版 / session 工厂)全可注入,缺省用真实实现(懒加载,
避免 import-time 触发 AI 配置)。测试注入桩即可离线跑通,不联网、不碰对象存储。
"""

from __future__ import annotations

import dataclasses
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from windup_ai_engine.ports import PromptRejected
from windup_ai_engine.slicing.quality import subject_blobs
from windup_common.directions import direction_prompt
from windup_common.models import ActionSpec, ActionType as EngineActionType, CharacterCard
from windup_framework.gateway import bind_call_context, fresh_gateway_request
from windup_framework.gateway.registry import ModelRegistry
from windup_framework.gateway.types import Scene
from windup_framework.config.quality_gate import settings as gate_settings

from windup_app.server.orchestrator import billing, generation_io, i2v_poll, quality_gate, task_repo
from windup_app.server.orchestrator._failure import user_message
from windup_app.server.orchestrator.i2v_poll import ActionAwaitingVideo
from windup_app.server.orchestrator._fetch import fetch_own_media
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterImageInput,
    TaskStatus,
)

if TYPE_CHECKING:
    from windup_ai_engine.ports import CharacterGeneratorPort, JudgePort, ProgressPort
    from windup_framework.providers import ImageProvider, MatteProvider

logger = logging.getLogger("windup.generation.executor")

_ACTION_RESULT = "character_action"  # task_repo._deserialize_result 按此标签反序列化


class _PollSkip(Exception):
    """续跑时任务已终态,直接 ACK。"""


def _settle_credit(session: Session, task_id: int, *, success: bool) -> None:
    """任务终态时结清预付费：成功扣减，失败解冻。"""
    task = task_repo.get_task(session, task_id)
    if task is None or task.id is None:
        return
    if success:
        billing.capture_for_task(session, user_id=task.user_id, task_id=task.id)
    else:
        billing.release_for_task(session, user_id=task.user_id, task_id=task.id)


# ── 项目全局约束(Project 表)→ 统合喂给生成逻辑 ─────────────────────────
# character_perspective 游戏视角:1=横版(侧视) 2=俯视 3=2.5D → 生成朝向/视角
_PERSPECTIVE_FACING: dict[int, str] = {1: "side", 2: "front", 3: "front"}
_PERSPECTIVE_VIEW: dict[int, str] = {
    1: "side view, horizontal side-scroller",
    2: "top-down view",
    3: "2.5D three-quarter view",
}
# directional_movement 移动方向:1=单向 2=四向 3=八向 → 需生成的方向数
_MOVEMENT_DIRECTIONS: dict[int, int] = {1: 1, 2: 4, 3: 8}


@dataclass
class ProjectConstraints:
    """从 Project 取的全局生成约束,统一约束角色图/动作生成。"""

    facing: str = "side"  # character_perspective → 朝向(须与母版一致 #35)
    view: str = "side view, horizontal side-scroller"
    perspective: int = 1  # 1横版 2俯视 3 2.5D
    directions: int = 1  # directional_movement → 方向数(1/4/8)
    sprite_w: int = 256  # 输出/切帧尺寸(关键)
    sprite_h: int = 256
    style: str = ""  # game_style 画风
    stylize: str = "none"  # 由 style 推:像素游戏 → pixel
    sprite_sample_url: str = ""  # 项目风格参考图 URL


def _load_constraints(session: Session, project_id: int | None) -> ProjectConstraints:
    """查 Project 组装全局约束;无 project_id / 查不到 → 缺省。"""
    if project_id is None:
        return ProjectConstraints()
    from windup_app.server.project.service import SqlAlchemyProjectService

    p = SqlAlchemyProjectService().get_project(session, project_id)
    if p is None:
        return ProjectConstraints()
    style = p.game_style or ""
    is_pixel = "pixel" in style.lower() or "像素" in style
    return ProjectConstraints(
        facing=_PERSPECTIVE_FACING.get(p.character_perspective, "side"),
        view=_PERSPECTIVE_VIEW.get(p.character_perspective, _PERSPECTIVE_VIEW[1]),
        perspective=p.character_perspective,
        directions=_MOVEMENT_DIRECTIONS.get(p.directional_movement, 1),
        sprite_w=p.sprite_width,
        sprite_h=p.sprite_height,
        style=style,
        stylize="pixel" if is_pixel else "none",
        sprite_sample_url=p.sprite_sample_url or "",
    )


def _fit_to(png: bytes, w: int, h: int, *, smooth: bool = False) -> bytes:
    """把图等比 contain 进 w×h(透明补边),落实尺寸约束。

    ``smooth`` 决定重采样:序列帧是像素画,必须 NEAREST(插值会把硬边糊成灰边、
    并引入调色板外的颜色);全彩角色母版反过来,NEAREST 缩图会明显锯齿,用 LANCZOS。
    """
    import io

    from PIL import Image

    im = Image.open(io.BytesIO(png)).convert("RGBA")
    if im.size == (w, h):
        return png
    # 小于画布也要缩放:原尺寸贴入会按画布比例压小主体占幅、把脚线一并上移,而母版是
    # 交付物,后面没有环节把这两样补回来(#512)。取整兜到 1 像素,免得极端长宽比缩成
    # 空图 —— 那是一张能通过尺寸断言的全透明母版。
    scale = min(w / im.width, h / im.height)
    fitted = im.resize(
        (max(1, round(im.width * scale)), max(1, round(im.height * scale))),
        Image.LANCZOS if smooth else Image.NEAREST,
    )
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(fitted, ((w - fitted.width) // 2, (h - fitted.height) // 2))
    buf = io.BytesIO()
    canvas.save(buf, "PNG")
    return buf.getvalue()


def _require_size(png: bytes, w: int, h: int) -> bytes:
    """核对引擎交付帧确实是项目要的尺寸,不对就报错 —— **不做静默补救**。

    这里以前是 ``_fit_to``:尺寸对不上就缩放补边。看着稳,实际是把"引擎没按尺寸出帧"
    这件事悄悄抹平,代价是脚线对齐被破坏(见 ``_produce_action`` 的说明)。尺寸现在由
    引擎按 ``canvas`` 负责,对不上说明生成侧出了问题,该让它响,而不是交付一批对齐
    坏掉的帧 —— 那正是本仓最忌讳的"看起来成功的错产物"。
    """
    import io

    from PIL import Image

    size = Image.open(io.BytesIO(png)).size
    if size != (w, h):
        raise ValueError(
            f"引擎交付帧尺寸 {size[0]}×{size[1]} 与项目约束 {w}×{h} 不一致;"
            "生成侧未按 canvas 出帧,不做静默缩放补救。"
        )
    return png


class _LogProgress:
    """进度上报占位:MVP 无 SSE,记日志即可。"""

    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        logger.info("[gen] %s %s/%s %s", stage, i, total, note)


def _resolve_video_model(name: str | None) -> str | None:
    """校验并返回视频模型名;``None`` 表示用部署默认值。

    只允许是 CHARACTER_ACTION 链上的一员,含义是「这次从它开始试」。
    非法取值在入口炸,不等到付费调用才失败。
    """
    if name is None:
        return None
    chain = ModelRegistry.from_settings().chain(Scene.CHARACTER_ACTION)
    if name not in chain:
        raise ValueError(f"视频模型 {name!r} 不在本期开放列表内。可选:" + "；".join(chain))
    return name


def _judged_action(input: CharacterActionInput) -> str:
    """判官要判的是"这帧是不是这个动作",而 custom 的动作内容在 ``custom_prompt`` 里。

    传枚举值 ``"custom"`` 等于问"这帧是不是 custom",判官无从判断:拦截档开启时会把
    所有自定义动作误判成不匹配,shadow 期的自定义读数也全是噪声。
    """
    if input.action_type is ActionType.CUSTOM:
        prompt = (input.custom_prompt or "").strip()
        if prompt:
            return prompt
    return input.action_type.value


def _to_engine_action(t) -> EngineActionType:
    """generation.ActionType → 引擎 common.ActionType(按值映射)。

    walk/idle/attack/**custom** 直通(custom 自 #239 起引擎已支持)。
    引擎仍未覆盖的类型在此抛带原因的错误,而不是让请求走到一半失败。
    """
    try:
        return EngineActionType(t.value)
    except ValueError as e:
        raise ValueError(f"动作类型 {t.value!r} 暂不支持视频生成路线") from e


class ActionTaskExecutor:
    """把一个 PENDING 动作任务跑成 COMPLETED/FAILED。"""

    def __init__(
        self,
        *,
        generator: CharacterGeneratorPort | None = None,
        judge: JudgePort | None = None,
        upload: Callable[[bytes], str] | None = None,
        fetch_master: Callable[[CharacterActionInput], bytes] | None = None,
        fetch_model3d: Callable[[str], bytes] | None = None,
        fetch_constraints: Callable[[Session, int | None], ProjectConstraints]
        | None = None,
        session_factory: Callable[[], Session] | None = None,
    ) -> None:
        self._generator = generator  # None → 懒加载真实装配(一套共享 Gateway)
        # 选哪个 kling 是 Gateway 读 start_from_model 的事,不分模型桶。
        # 三渲二的渲染方向数仍属项目约束:4 向和 8 向的相机表不同,必须分桶,
        # 否则先请求的项目会把后续项目的方向数锁死。directions=1 用整数 1
        # 做键,已有 `_get_generator()` 调用仍走同一份。
        self._by_model: dict[int, CharacterGeneratorPort] = {}
        # 抠图 / 图生图与视频 Gateway 无关方向分桶,所有桶共用一份:每个抠图实例
        # 都会惰性加载一份 ONNX 会话,按桶各建等于把同一个模型在进程里装多次。
        self._matte: MatteProvider | None = None
        self._image: ImageProvider | None = None
        # 判官同样与视频模型无关,故不分桶。缺省 None 时**不建**实例:建了就意味着每个
        # 任务多一次付费调用,那要由 QUALITY_GATE_ENABLED 显式打开,见 _get_judge。
        self._judge: JudgePort | None = judge
        # 本执行器是进程级单例,而每个请求起一个线程跑 run_action_task,上面几个缓存
        # 都是跨线程共用的可变状态。缺锁时并发首请求会各装一套(见 _get_generator)。
        self._assembly_lock = threading.Lock()
        self._upload = upload  # None → 真实对象存储上传
        self._fetch_master = fetch_master  # None → 下载 reference_image_urls[0]
        self._fetch_model3d = fetch_model3d  # None → 下载 input.model_3d_url
        self._fetch_constraints = fetch_constraints  # None → 查 project 全局约束
        self._session_factory = session_factory  # None → SessionLocal

    def run_action_task(
        self,
        task_id: int,
        input: CharacterActionInput,
        project_id: int | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        """跑一个动作任务;异常兜底为 FAILED,不抛。

        先从 ``project`` 取全局约束(朝向/画风/尺寸/方向)再调 ai_engine。``session``
        缺省时自开短 session(标 RUNNING / 写终态各一次),生成期间不占连接;
        测试可传入自己的 session,则全程复用、不代为 commit。
        """
        reset = None
        try:
            def _mark_running(s: Session) -> ProjectConstraints:
                task_repo.update_status(s, task_id, TaskStatus.RUNNING)
                return (self._fetch_constraints or _load_constraints)(s, project_id)

            cons = generation_io.using_session(session, self._make_session, _mark_running)
            reset = bind_call_context(
                task_id=str(task_id),
                start_from_model=_resolve_video_model(input.video_model),
            )
            result = self._produce_action(input, cons, task_id=task_id)

            def _complete(s: Session) -> None:
                task_repo.update_result(s, task_id, _ACTION_RESULT, result)
                _settle_credit(s, task_id, success=True)

            generation_io.using_session(session, self._make_session, _complete)
        except ActionAwaitingVideo:
            logger.info("动作任务 %s 已提交 i2v,等待延迟轮询", task_id)
        except PromptRejected as exc:
            # 单独捕获而不是落进下面那个兜底:兜底只存 str(exc),``code`` 就丢了,server
            # 于是分不出"用户改一句话就能过的输入错"和"引擎故障",只能去解析异常文本。
            logger.info("动作任务 %s 的描述被措辞门禁拒绝: %s", task_id, exc.code.value)
            error_message = user_message(exc)

            def _reject(s: Session) -> None:
                task_repo.fail_task(s, task_id, error_message=error_message)

            generation_io.using_session(session, self._make_session, _reject)
        except Exception as exc:  # noqa: BLE001 —— 兜底任何生成/上传/网络异常
            logger.exception("动作任务 %s 失败", task_id)
            if session is not None:
                session.rollback()
            error_message = user_message(exc)

            def _fail(s: Session) -> None:
                task_repo.fail_task(s, task_id, error_message=error_message)
                _settle_credit(s, task_id, success=False)

            generation_io.using_session(session, self._make_session, _fail)
        finally:
            if reset is not None:
                reset()

    # -- 内部 --------------------------------------------------------------

    def _produce_action(
        self,
        input: CharacterActionInput,
        cons: ProjectConstraints,
        *,
        task_id: int,
    ) -> dict:
        """母版 → ai_engine 按项目尺寸出帧 → 逐帧上传 → 组结果 dict。

        项目约束落实:``facing`` 随视角、``stylize`` 随画风(像素游戏→像素化)、
        输出帧尺寸随 ``sprite_w×sprite_h``。四向/八向项目由上层为每个必需方向
        创建独立任务；本任务只生成 ``input.direction``，不会用镜像替代西向或斜向。

        **尺寸是传给引擎的,不是拿到帧再缩的。** 这里曾对每帧再做一次
        ``_fit_to(png, sprite_w, sprite_h)``:引擎恒出 256,项目要 512 就等于二次
        重采样。而 ``_fit_to`` 用 ``Image.thumbnail`` —— 它**只缩不放**,放大方向
        根本不放大,只是把 256 的帧原尺寸居中贴进 512 画布,于是引擎刚对齐好的脚线
        0.92 被挪到 0.709,角色不站在地上、跨动作对齐一并失效。
        现在把 ``canvas`` 交给引擎,它一次就出到项目尺寸,那一步整个不存在了。
        """
        if cons.directions > 1:
            logger.info(
                "项目要求 %s 方向，本任务负责独立方向 %s",
                cons.directions,
                input.direction.value,
            )
        # 视频 i2v 没有独立的 style reference 字段,风格约束走提示词文字
        desc_parts = [input.custom_prompt or "", direction_prompt(input.direction)]
        if cons.style:
            desc_parts.append(f"Art style: {cons.style}")
        # 体型必须从请求一路传到这里 —— 只在 ai_engine 侧加门禁的话,生产链路恒走
        # CharacterCard 的 BIPED 默认值,四足/蛇形角色永远触发不了它(机器审逮到)。
        card = CharacterCard(
            name=f"char-{input.character_id}",
            desc=" ".join(desc_parts),
            **({"stance": input.stance} if input.stance is not None else {}),
        )
        engine_action = _to_engine_action(input.action_type)
        # custom 的动作内容与循环性是 ActionSpec 的必填字段。但 cyclic 由本层补上默认值,
        # 所以 ActionSpec 里那道 `cyclic is None` 守卫拦不到走这条路径的请求 —— 它保的是
        # 其他直接构造 ActionSpec 的调用方。
        extra: dict[str, object] = {}
        if engine_action is EngineActionType.CUSTOM:
            # 缺 loop 时兜成一次性,依据是失败代价不对称:一次性误当循环会让末帧接回首帧
            # 抽搐、产物不可用;反之只是不无缝闭环、仍可用。不从描述文字猜。
            cyclic = False if input.loop is None else bool(input.loop)
            # 缺 ground_contact 时兜成"有地面接触":绝大多数自述动作有脚踩地,而误判成
            # 全程离地会让角色不站在地上 —— 比飞行动作上下浮动严重。
            grounded = True if input.ground_contact is None else bool(input.ground_contact)
            extra = {
                "custom_action": input.custom_prompt or "",
                "cyclic": cyclic,
                "ground_contact": grounded,
            }
        action = ActionSpec(
            action=engine_action,
            poses=[""] * input.num_frames,
            facing=cons.facing,
            direction=input.direction,
            stylize=cons.stylize,
            **extra,
        )
        progress: ProgressPort = _LogProgress()
        canvas = (cons.sprite_w, cons.sprite_h)

        reset_call = fresh_gateway_request()
        try:
            # ── 路线选择:这一步是 server 的事,不是引擎的(#122)────────────────
            #
            # 判据就一条:这个造型有没有绑骨 3D 模型(character_data.outfits[].model_3d_url,
            # 由 web 层读出来放进 input)。有 → 三渲二;没有 → 照旧 i2v。
            #
            # **不静默回退。** 拿到了 model_3d_url 却下载不下来 / 渲不出来,就报错,不改走
            # i2v —— 两条路线的画风、成本、多朝向能力都不同,悄悄换一条等于让调用方拿着
            # 错误的前提做后续决定,而帧数、时长、成色全都正常,没有任何一道会红。
            #
            # 选哪个 kling 不在这里传:run_action_task 已经 bind_call_context(start_from_model)。
            model_url = (input.model_3d_url or "").strip()
            # 三渲二那支不取母版,而出口的判官闸口要拿它当参照 —— 不先置 None 的话那支会
            # 撞 UnboundLocalError,而它只在有 3D 资产的造型上触发。
            master: bytes | None = None
            if model_url:
                rigged = (self._fetch_model3d or self._download_model3d)(model_url)
                logger.info(
                    "[gen] 造型 %s 有 3D 资产(%d bytes),走三渲二",
                    input.outfit_id or "?",
                    len(rigged),
                )
                generated = self._get_generator(
                    _resolve_video_model(input.video_model), cons.directions
                ).generate_rendered(card, action, rigged, progress, canvas=canvas)
            else:
                master = (self._fetch_master or self._download_master)(input)
                gen = self._get_generator(
                    _resolve_video_model(input.video_model), cons.directions
                )
                # 注入的测试桩通常只有 generate()。生产装配且 VideoGateway 支持
                # start_i2v 时,建单后把轮询丢进 ZSET,立刻让出 action worker。
                can_defer = getattr(gen, "can_defer_i2v", None)
                if hasattr(gen, "start_video") and (
                    can_defer() if callable(can_defer) else True
                ):
                    job = gen.start_video(card, action, master, progress, canvas=canvas)
                    i2v_poll.schedule(task_id, job, poll_count=0)
                    raise ActionAwaitingVideo
                generated = gen.generate(card, action, master, progress, canvas=canvas)

            return self._deliver_generated(generated, input, cons, master)
        finally:
            reset_call()

    def resume_action_poll(
        self,
        task_id: int,
        input: CharacterActionInput,
        project_id: int | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        """延迟队列到期后探一次 i2v。仍在跑则再挂单;完成则抽帧交付。"""
        reset = None
        try:
            def _mark_running(s: Session) -> ProjectConstraints:
                task = task_repo.get_task(s, task_id)
                if task is None:
                    raise RuntimeError(f"任务 {task_id} 不存在")
                if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
                    raise _PollSkip(f"任务 {task_id} 已终态")
                return (self._fetch_constraints or _load_constraints)(s, project_id)

            try:
                cons = generation_io.using_session(session, self._make_session, _mark_running)
            except _PollSkip:
                return

            reset = bind_call_context(
                task_id=str(task_id),
                start_from_model=_resolve_video_model(input.video_model),
            )
            gen = self._get_generator(
                _resolve_video_model(input.video_model), cons.directions
            )
            reset_call = fresh_gateway_request()
            try:
                outcome = i2v_poll.inspect(task_id, poll_video=gen.poll_video)
                if isinstance(outcome, i2v_poll.Waiting):
                    return

                card, action, canvas = self._action_spec(input, cons)
                progress: ProgressPort = _LogProgress()
                master = (self._fetch_master or self._download_master)(input)
                generated = gen.finish_video(
                    outcome.video, card, action, master, progress, canvas=canvas
                )
                result = self._deliver_generated(generated, input, cons, master)
            finally:
                reset_call()
            i2v_poll.clear(task_id)

            def _complete(s: Session) -> None:
                task_repo.update_result(s, task_id, _ACTION_RESULT, result)
                _settle_credit(s, task_id, success=True)

            generation_io.using_session(session, self._make_session, _complete)
        except PromptRejected as exc:
            logger.info("动作任务 %s 的描述被措辞门禁拒绝: %s", task_id, exc.code.value)
            error_message = user_message(exc)

            def _reject(s: Session) -> None:
                task_repo.fail_task(s, task_id, error_message=error_message)

            generation_io.using_session(session, self._make_session, _reject)
        except Exception as exc:  # noqa: BLE001
            logger.exception("动作任务 %s 轮询失败", task_id)
            if session is not None:
                session.rollback()
            error_message = user_message(exc)

            def _fail(s: Session) -> None:
                task_repo.fail_task(s, task_id, error_message=error_message)
                _settle_credit(s, task_id, success=False)

            generation_io.using_session(session, self._make_session, _fail)
        finally:
            if reset is not None:
                reset()

    def _action_spec(
        self, input: CharacterActionInput, cons: ProjectConstraints
    ) -> tuple[CharacterCard, ActionSpec, tuple[int, int]]:
        if cons.directions > 1:
            logger.info(
                "项目要求 %s 方向，本任务只负责真实源方向 %s；镜像方向由资产层复用",
                cons.directions,
                input.direction.value,
            )
        desc_parts = [input.custom_prompt or "", direction_prompt(input.direction)]
        if cons.style:
            desc_parts.append(f"Art style: {cons.style}")
        card = CharacterCard(
            name=f"char-{input.character_id}",
            desc=" ".join(desc_parts),
            **({"stance": input.stance} if input.stance is not None else {}),
        )
        engine_action = _to_engine_action(input.action_type)
        extra: dict[str, object] = {}
        if engine_action is EngineActionType.CUSTOM:
            cyclic = False if input.loop is None else bool(input.loop)
            extra = {"custom_action": input.custom_prompt or "", "cyclic": cyclic}
        action = ActionSpec(
            action=engine_action,
            poses=[""] * input.num_frames,
            facing=cons.facing,
            direction=input.direction,
            stylize=cons.stylize,
            **extra,
        )
        return card, action, (cons.sprite_w, cons.sprite_h)

    def _deliver_generated(
        self,
        generated,
        input: CharacterActionInput,
        cons: ProjectConstraints,
        master: bytes | None,
    ) -> dict:
        upload = self._upload or self._upload_frame
        checked = [_require_size(png, cons.sprite_w, cons.sprite_h) for png in generated.frames]
        # 上传与判官都是网络 IO 且互不依赖:判官读内存 bytes。handler 线程跑 review,
        # IO 池跑 PUT,避免 32 帧传完再打一次视觉模型。
        upload_futs = generation_io.submit_io(upload, checked) if len(checked) > 1 else None
        decision = quality_gate.review(
            self._get_judge(), checked, master, _judged_action(input)
        )
        urls = (
            [fut.result() for fut in upload_futs]
            if upload_futs is not None
            else generation_io.upload_frames(upload, checked)
        )
        frames = [
            {"index": i, "image_url": url, "duration_ms": dur}
            for i, (url, dur) in enumerate(zip(urls, generated.durations))
        ]
        result = {
            "type": "character_action",
            "action_type": input.action_type.value,
            "direction": input.direction.value,
            "frames": frames,
            "quality": dataclasses.asdict(generated.quality),
            "prompt_version": generated.prompt_version,
        }
        # 落位几何随产物一起交出:消费方要把帧画到画布上、判角色有没有站在地上,
        # 而这条线的比例是对齐那一步的实参。前端此前抄了一份 0.92 自己算 —— 两份
        # 常数只要有一次不同步,角色就不站在地上,而没有任何一道会红。
        if generated.geometry is not None:
            g = generated.geometry
            result["geometry"] = {
                "canvas_width": g.canvas_w,
                "canvas_height": g.canvas_h,
                "anchor": {"x": g.anchor_x, "y": g.anchor_y},
                "foot_y": g.foot_y,
            }
        if decision is not None:
            result["judge"] = decision.as_payload()
            if decision.blocked:
                raise quality_gate.QualityBlocked(decision.problems)
        return result

    def _get_judge(self) -> JudgePort | None:
        """闸口启用时懒建判官;未启用返回 ``None``,一次调用都不发。"""
        if self._judge is not None or not gate_settings.enabled:
            return self._judge
        with self._assembly_lock:
            if self._judge is None:
                from windup_framework.providers import SufyJudgeProvider

                self._judge = SufyJudgeProvider()
            return self._judge

    def _get_generator(
        self,
        video_model: str | None = None,
        directions: int = 1,
    ) -> CharacterGeneratorPort:
        """懒装配 CharacterGenerator(ImageGateway + VideoGateway + matte)。

        选哪个 kling 不在装配时定,由 bind_call_context 的 start_from_model 交给 Gateway。
        ``video_model`` 仍接入口传入,但不参与分桶;分桶只为三渲二的方向数。
        """
        del video_model
        if self._generator is not None:
            return self._generator
        # 命中缓存的快路径不进锁,否则每个请求都要在这里排一次队。只有装配新桶才上锁,
        # 锁内重查一次:两个线程同时错过同一个桶时,后进来的那个要看见前一个的成果。
        cached = self._by_model.get(directions)
        if cached is not None:
            return cached
        with self._assembly_lock:
            cached = self._by_model.get(directions)
            if cached is None:
                cached = self._assemble(directions)
                self._by_model[directions] = cached
            return cached

    def _assemble(self, directions: int) -> CharacterGeneratorPort:
        """装一个方向桶。**调用方须持有 ``self._assembly_lock``**(会写共用 provider)。"""
        from windup_ai_engine.impl import CharacterGenerator
        from windup_ai_engine.strategy.concrete import (
            PerFrameStrategy,
            VideoFrameStrategy,
        )
        from windup_common.models import GenRoute
        from windup_framework.gateway import build_image_gateway, build_video_gateway
        from windup_framework.gateway.image import _CIRCUIT
        from windup_framework.providers import OnnxU2NetMatteProvider

        if self._matte is None:
            self._matte = OnnxU2NetMatteProvider()
        if self._image is None:
            self._image = build_image_gateway(circuit=_CIRCUIT)
        video = build_video_gateway(circuit=_CIRCUIT)
        # 装配表必须与 GenRoute 对齐。下面那条断言让漏装在装配时暴露,而不是等到某个
        # 动作第一次被请求时才炸——注入 generator 的测试走不到这条装配路径,漏了会测试
        # 全绿而真实调用全崩。
        strategies = {
            GenRoute.VIDEO_I2V: VideoFrameStrategy(video, self._matte),
            GenRoute.PER_FRAME: PerFrameStrategy(self._image, self._matte),
            GenRoute.RENDER_3D: self._build_render3d(directions),
        }
        missing = set(GenRoute) - set(strategies)
        if missing:
            raise RuntimeError(
                f"GenRoute 新增了 {sorted(r.value for r in missing)} 但 executor 未装配;"
                "补上或在此显式说明为何不装。"
            )
        return CharacterGenerator(strategies)

    @staticmethod
    def _build_render3d(directions: int):
        """三渲二的**渲帧**那一段。纯本地(node + playwright + three.js),零 API 成本。

        真被请求时才 import 出帧台那套依赖:它只有这条路线用得着,装配期就要齐会让本来
        走 i2v 的任务也因为它没配好而起不来。

        **图生 3D 与绑骨那两段不在这里** —— 它们按次计费、每造型一次性,由
        ``render3d_assets.Render3DAssetBuilder`` 在请求路径之外做(带一道人工确认停点),
        产物 URL 落在 ``outfits[].model_3d_url`` 上。捆进来就等于一个 web 请求能顺手扣钱。
        """
        from windup_ai_engine.strategy.base import DerivationStrategy
        from windup_common.models import GenRoute

        # 项目可选单向(1/4/8)，但 3D 出帧台的相机表只接受四向或八向。
        # 单向任务仍通过 ActionSpec.direction 只请求 east；这里的 4 只是底层表规格。
        renderer_directions = 4 if directions == 1 else directions

        class _LazyRenderStrategy(DerivationStrategy):
            route = GenRoute.RENDER_3D

            def __init__(self) -> None:
                self._inner: DerivationStrategy | None = None

            def derive(self, card, action, source, progress):
                if self._inner is None:
                    from windup_ai_engine.strategy.concrete import RenderFrameStrategy
                    from windup_framework.providers.render3d import (
                        LocalSpriteRenderProvider,
                    )

                    self._inner = RenderFrameStrategy(
                        LocalSpriteRenderProvider(),
                        directions=renderer_directions,
                    )
                return self._inner.derive(card, action, source, progress)

        return _LazyRenderStrategy()

    def _download_model3d(self, url: str) -> bytes:
        """取该造型的绑骨 3D 模型。走 ``fetch_own_media`` —— 与母版同一条受限通路
        (只允许本站对象存储的域名,防 SSRF)。模型动辄二三十 MB,但和母版一样是
        **一次性下载、进内存、喂引擎**,不落 ai_engine 的存储(它只吃 bytes)。
        """
        return fetch_own_media(url)

    def _download_master(self, input: CharacterActionInput) -> bytes:
        if not input.reference_image_urls:
            raise ValueError("缺少母版:reference_image_urls 为空")
        # 只允许拉自家对象存储:这个 URL 来自请求体,直接 httpx.get 等于把服务器
        # 当跳板(可打 loopback / 云元数据服务 / 私网)。详见 _fetch 模块 docstring。
        return fetch_own_media(input.reference_image_urls[0])

    def _upload_frame(self, png: bytes) -> str:
        from windup_app.server.media.model import MediaCategory, MediaUploadInput
        from windup_app.server.media.service import service as media_service

        meta = MediaUploadInput(
            filename="frame.png",
            content_type="image/png",
            size=len(png),
            category=MediaCategory.ACTION_FRAME,
        )
        return media_service.upload(png, meta).url

    def _make_session(self) -> Session:
        if self._session_factory is not None:
            return self._session_factory()
        from windup_framework.db.session import SessionLocal

        return SessionLocal()


_IMAGE_RESULT = "character_image"  # task_repo._deserialize_result 按此标签反序列化


class ImageTaskExecutor:
    """跑角色图片生成任务:参考图 + prompt → 图生图 → 上传 → 回写 image_url。"""

    def __init__(
        self,
        *,
        image=None,  # None → 懒加载 ImageGateway
        matte: MatteProvider | None = None,  # None → 懒加载 OnnxU2NetMatteProvider
        upload: Callable[[bytes], str] | None = None,  # None → 真实对象存储上传
        fetch_ref: Callable[[str], bytes]
        | None = None,  # None → 下载 reference_image_url
        session_factory: Callable[[], Session] | None = None,
    ) -> None:
        self._image = image
        self._matte = matte
        self._upload = upload
        self._fetch_ref = fetch_ref
        self._session_factory = session_factory
        self._assembly_lock = threading.Lock()

    def run_image_task(
        self,
        task_id: int,
        input: CharacterImageInput,
        project_id: int | None = None,
        *,
        session: Session | None = None,
    ) -> None:
        reset = None
        try:
            def _mark_running(s: Session) -> ProjectConstraints:
                task_repo.update_status(s, task_id, TaskStatus.RUNNING)
                return _load_constraints(s, project_id)

            cons = generation_io.using_session(session, self._make_session, _mark_running)
            reset = bind_call_context(task_id=str(task_id))
            urls, quality = self._produce_image(input, cons)

            def _complete(s: Session) -> None:
                task_repo.update_result(
                    s,
                    task_id,
                    _IMAGE_RESULT,
                    {
                        "type": "character_image",
                        "direction": input.direction.value,
                        "image_urls": urls,
                        "quality": quality,
                    },
                )
                _settle_credit(s, task_id, success=True)

            generation_io.using_session(session, self._make_session, _complete)
        except Exception as exc:  # noqa: BLE001 —— 兜底
            logger.exception("图片任务 %s 失败", task_id)
            if session is not None:
                session.rollback()
            error_message = user_message(exc)

            def _fail(s: Session) -> None:
                task_repo.fail_task(s, task_id, error_message=error_message)
                _settle_credit(s, task_id, success=False)

            generation_io.using_session(session, self._make_session, _fail)
        finally:
            if reset is not None:
                reset()

    def _produce_image(
        self, input: CharacterImageInput, cons: ProjectConstraints
    ) -> tuple[list[str], dict]:
        """根据项目约束决定生成模式,返回 (URL 列表, 成色读数)。

        模式判断:
          - 项目有 sprite_sample_url → **图生图**: 风格参考图 + 提示词
          - 项目无 sprite_sample_url → **文生图**: 纯提示词
        用户传入的 reference_image_url 始终作为角色一致性参考(可选)。
        """
        fetch = self._fetch_ref or self._download
        refs: list[bytes] = []
        has_style_ref = False

        def _is_url(url: str) -> bool:
            return bool(url) and url.lower() not in ("null", "none", "")

        # 1. 角色参考图(用户传入,可选,做角色一致性约束)
        char_url = (input.reference_image_url or "").strip()
        # 2. 风格参考图(项目级,有 sprite_sample_url 时走图生图模式)
        style_url = (cons.sprite_sample_url or "").strip()
        want_char = _is_url(char_url)
        want_style = _is_url(style_url)

        def _fetch_style(url: str) -> bytes | None:
            try:
                return fetch(url)
            except Exception:
                return None

        if want_char and want_style:
            char_bytes, style_bytes = generation_io.io_map(
                lambda item: fetch(item[1]) if item[0] == "char" else _fetch_style(item[1]),
                (("char", char_url), ("style", style_url)),
            )
            refs.append(char_bytes)
            if style_bytes is not None:
                refs.append(style_bytes)
                has_style_ref = True
        else:
            if want_char:
                refs.append(fetch(char_url))
            if want_style:
                style_bytes = _fetch_style(style_url)
                if style_bytes is not None:
                    refs.append(style_bytes)
                    has_style_ref = True

        # 3. 构建提示词
        base = (
            input.prompt
            or "Clean full-body character reference of the figure in the image."
        )
        parts = [
            base,
            f"{cons.view}, full body head to feet, centered.",
            direction_prompt(input.direction),
        ]
        if cons.style:
            parts.append(f"Art style: {cons.style}.")
        parts.append("Plain light-gray background, no shadow.")

        # 图生图模式:明确标注两张图的各自用途
        if has_style_ref:
            prefix = (
                "This is an image-to-image task. "
                "The first image is the CHARACTER reference — preserve its identity. "
                "The second image is the STYLE reference — follow its art style, "
                "color palette, and rendering technique. "
            )
            parts.insert(0, prefix)

        prompt = " ".join(parts)

        import io

        from PIL import Image

        image_gen = self._get_image()
        matte = self._get_matte()
        upload = self._upload or self._upload_image

        def _gen_one(_i: int) -> bytes:
            reset_call = fresh_gateway_request()
            try:
                return image_gen.gen_image(prompt, refs)
            finally:
                reset_call()

        # 多张候选各自一次付费调用,彼此独立;ContextVar 由 io_map 拷进 IO 线程。
        raws = generation_io.io_map(_gen_one, range(max(1, input.num_images)))
        # 抠图走 ONNX,同一会话不能并发 Run;上传再并行。
        cut: list[Image.Image] = []
        pngs: list[bytes] = []
        for img in raws:
            # 提示词要的是浅灰底,交付的母版却必须是透明底:不在这里抠,灰底会一路带进
            # 预览、也会成为下一次图生图的参考底色(#430)。抠在缩放之前 —— u2netp 按模型
            # 原始分辨率分割,先缩再抠等于把一半可用像素丢掉再让它猜。
            # 抠不动时让它抛:静默交一张带灰底的母版,正是"看起来成功的错产物"。
            # 请求里的 width/height 此前被丢掉:入口收下并校验过它们(_validate_project_size),
            # 而 ImageProvider.gen_image 没有尺寸参数,模型出多大就返多大 —— 又一个"接了不
            # 履约"的字段。模型本身不吃宽高,所以在这里落实。
            png = _fit_to(matte.cutout(img), input.width, input.height, smooth=True)
            cut.append(Image.open(io.BytesIO(png)).convert("RGBA"))
            pngs.append(png)
        urls = generation_io.upload_frames(upload, pngs)
        # 同一份 alpha 顺手数一次主体数(#427):此前多主体母版要等下一个动作任务才留痕,
        # 而那时钱已经花在错的母版上了。只记账,不在此处判成败 —— 与动作那条同一立场。
        return urls, {"subject_blobs": list(subject_blobs(cut))}

    def _get_image(self):
        if self._image is not None:
            return self._image
        with self._assembly_lock:
            if self._image is None:
                from windup_framework.gateway import build_image_gateway

                self._image = build_image_gateway()
            return self._image

    def _get_matte(self):
        if self._matte is not None:
            return self._matte
        with self._assembly_lock:
            if self._matte is None:
                from windup_framework.providers import OnnxU2NetMatteProvider

                self._matte = OnnxU2NetMatteProvider()
            return self._matte

    def _download(self, url: str) -> bytes:
        # 同 _download_master:参考图 URL 由调用方给,必须走白名单取图。
        return fetch_own_media(url)

    def _upload_image(self, png: bytes) -> str:
        from windup_app.server.media.model import MediaCategory, MediaUploadInput
        from windup_app.server.media.service import service as media_service

        meta = MediaUploadInput(
            filename="character.png",
            content_type="image/png",
            size=len(png),
            category=MediaCategory.REFERENCE_IMAGE,
        )
        return media_service.upload(png, meta).url

    def _make_session(self) -> Session:
        if self._session_factory is not None:
            return self._session_factory()
        from windup_framework.db.session import SessionLocal

        return SessionLocal()


# 默认执行器(真实依赖);bootstrap 取 run_action_task / run_image_task 注入 app.state
executor = ActionTaskExecutor()
run_action_task = executor.run_action_task
resume_action_poll = executor.resume_action_poll
image_executor = ImageTaskExecutor()
run_image_task = image_executor.run_image_task
