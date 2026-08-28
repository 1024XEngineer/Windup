"""生成任务 API。

契约层：定义前端请求/响应的 Pydantic 模型，与 server 层解耦。
实际逻辑由 server 层实现，本文件只做参数校验和格式转换。

端点一览
--------
POST /generation/image                     提交角色图片生成任务
POST /generation/four-view                 提交四向立绘 sheet
POST /generation/eight-view                提交八向立绘 sheet
POST /generation/action                    提交角色动作生成任务
GET  /generation/tasks/{task_id}           查询任务状态
GET  /generation/tasks/{task_id}/stream    SSE 订阅任务进度
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import math
import os
from collections import defaultdict

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.directions import (
    ActionDirection,
    is_required_direction,
    required_directions_for_movement,
)
from windup_common.exceptions import BizException
from windup_common.models import CharacterStance
from windup_common.result import Response
from windup_framework.db import get_session
from windup_framework.db.session import SessionLocal
from windup_framework.mq.publisher import MqPublisher

from windup_app.server.character.model import Character, CharacterData
from windup_app.server.orchestrator import billing, task_repo
from windup_app.server.mq.catalog import (
    msg_type_for_generation,
    stream_for_msg_type,
)
from windup_app.server.orchestrator.service import service as generation_service
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterDirectionSetInput,
    CharacterImageInput,
    CharacterViewSheetInput,
    GenerationTask,
)
from windup_app.server.project.model import Project

logger = logging.getLogger("windup.generation.api")

router = APIRouter(prefix="/generation", tags=["generation"])


# ══════════════════════════════════════════════════════════════════════════════
# EventBus（任务进度推送）
# ══════════════════════════════════════════════════════════════════════════════

def _positive_interval(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("%s=%r 不是秒数，使用默认值 %.1f", name, raw, default)
        return default
    if not math.isfinite(value) or value <= 0:
        logger.warning("%s=%r 必须大于 0，使用默认值 %.1f", name, raw, default)
        return default
    return value


# 心跳必须明显短于常见的 30 秒代理空闲断连边界；终态查库仍保持低频。
_HEARTBEAT_SECONDS = _positive_interval("WINDUP_SSE_HEARTBEAT_SECONDS", 10.0)
_TERMINAL_POLL_SECONDS = _positive_interval("WINDUP_SSE_TERMINAL_POLL_SECONDS", 30.0)
_SUBSCRIBER_QUEUE_CAPACITY = 64

# 终态事件
_TERMINAL_EVENTS = {"completed", "partial", "failed"}


def _poll_terminal_snapshot(task_id: int, project_id: int) -> tuple[str, dict] | None:
    """SSE heartbeat 查库兜底：Pub/Sub 断线期间错过的终态由此补发。"""
    session = SessionLocal()
    try:
        return task_repo.terminal_snapshot(session, task_id, project_id)
    finally:
        session.close()


def _load_stream_start(
    *,
    user_id: int,
    project_id: int,
    task_id: int,
) -> tuple[str | None, dict | None]:
    """鉴权并读终态快照。短 session,返回后连接立刻归还。

    不能 ``Depends(get_session)``:FastAPI 会把 session 握到 StreamingResponse
    结束。压测里十几路进度流就能把 QueuePool(5+10) 打满,普通 ``GET /tasks/{id}``
    跟着 30s timeout,前端直接报错。
    """
    session = SessionLocal()
    try:
        _get_project_or_raise(session, project_id, user_id)
        task = task_repo.get_task(session, task_id)
        if task is None or task.project_id != project_id:
            raise BizException("任务不存在", code=BizCode.NOT_FOUND)
        event = task_repo.terminal_event_for(task)
        payload = task_repo.task_event_payload(task) if event is not None else None
        return event, payload
    finally:
        session.close()


class _EventBus:
    """任务进度内存发布-订阅。

    **publish 会被后台线程调用**(executor 在生成工作线程里跑,经 task_repo 触发),
    而队列属于处理 SSE 请求的那个 event loop。``asyncio.Queue`` 不是线程安全的:
    跨线程 ``put_nowait`` 能把元素放进去,但唤醒 waiter 用的是 loop 内部调度,
    从别的线程调不会唤醒 —— 订阅者可能一直挂在 ``get()`` 上,直到下一次同 loop 内的
    操作偶然把它带起来。故订阅时记下所属 loop,发布时经 ``call_soon_threadsafe``
    回到那个 loop 上再入队(2026-08-10 机器审逮到)。
    """

    def __init__(self, *, queue_capacity: int = _SUBSCRIBER_QUEUE_CAPACITY) -> None:
        if queue_capacity <= 0:
            raise ValueError("queue_capacity 必须大于 0")
        self._queue_capacity = queue_capacity
        # 键是 (project_id, task_id):同一个 task_id 在不同项目下互不串流(主线 #110)。
        # 值是 (queue, 它所属的 loop):不同订阅者可能来自不同 loop(多 worker / 测试里的
        # 临时 loop),不能只存一个全局 loop —— 见 publish 里的 call_soon_threadsafe。
        self._queues: dict[
            tuple[int, int], list[tuple[asyncio.Queue, asyncio.AbstractEventLoop]]
        ] = defaultdict(list)

    async def subscribe(self, project_id: int, task_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=self._queue_capacity)
        self._queues[(project_id, task_id)].append((queue, asyncio.get_running_loop()))
        return queue

    @staticmethod
    def _enqueue_latest(
        queue: asyncio.Queue,
        item: tuple[str, dict],
        task_id: int,
    ) -> None:
        if queue.full():
            try:
                dropped_event, _ = queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            else:
                logger.warning(
                    "SSE 订阅者消费过慢，丢弃最旧事件 task_id=%d event=%s",
                    task_id,
                    dropped_event,
                )
        queue.put_nowait(item)

    async def unsubscribe(
        self,
        project_id: int,
        task_id: int,
        queue: asyncio.Queue,
    ) -> None:
        key = (project_id, task_id)
        subs = self._queues.get(key)
        if not subs:
            return
        self._queues[key] = [(q, lp) for q, lp in subs if q is not queue]
        if not self._queues[key]:
            del self._queues[key]

    def publish(
        self,
        project_id: int,
        task_id: int,
        event: str,
        data: dict,
    ) -> None:
        """跨线程安全地投递。

        executor 在生成工作线程里跑,而队列属于处理 SSE 请求的那个 event loop。
        ``asyncio.Queue`` 不是线程安全的:跨线程 ``put_nowait`` 能把元素放进去,但唤醒
        waiter 用的是 loop 内部调度,从别的线程调不会唤醒 —— 订阅者可能一直挂在
        ``get()`` 上,直到下一次同 loop 内的操作偶然把它带起来。故订阅时记下所属 loop,
        发布时经 ``call_soon_threadsafe`` 回到那个 loop 上再入队。
        """
        try:
            here = asyncio.get_running_loop()
        except RuntimeError:
            here = None  # 从没有 loop 的生成工作线程调用

        for queue, loop in list(self._queues.get((project_id, task_id), [])):
            if loop is here:
                # 同一个 loop 内:直接入队。**不能一律走 call_soon_threadsafe** —— 那是
                # 异步调度,要等 loop 下一次迭代才真入队,于是"publish 完立刻 get_nowait"
                # 会拿到空队列(主线 #110 的隔离用例正是这么写的)。
                self._enqueue_latest(queue, (event, data), task_id)
                continue
            try:
                loop.call_soon_threadsafe(
                    self._enqueue_latest,
                    queue,
                    (event, data),
                    task_id,
                )
            except RuntimeError:
                # loop 已关闭(客户端断连后请求 loop 结束)。丢弃即可 —— 没有订阅者在等
                # 这条消息,而任务状态本身已落库,重连后靠 GET /tasks/{id} 取。
                logger.debug(
                    "SSE loop 已关闭,丢弃事件 task_id=%d event=%s", task_id, event
                )


async def _stream_events(
    *,
    request: Request,
    queue: asyncio.Queue,
    task_id: int,
    project_id: int,
    heartbeat_seconds: float = _HEARTBEAT_SECONDS,
    terminal_poll_seconds: float = _TERMINAL_POLL_SECONDS,
):
    """输出实时事件；进度可丢，终态由低频数据库快照保证最终一致。"""
    loop = asyncio.get_running_loop()
    next_terminal_poll = loop.time() + terminal_poll_seconds
    while True:
        if await request.is_disconnected():
            logger.debug("SSE 客户端断开: task_id=%d", task_id)
            return
        try:
            event, data = await asyncio.wait_for(queue.get(), timeout=heartbeat_seconds)
        except asyncio.TimeoutError:
            # 先保活再查库，避免慢查询把连接推过代理的空闲断连边界。
            yield ": heartbeat\n\n"
            if loop.time() < next_terminal_poll:
                continue
            next_terminal_poll = loop.time() + terminal_poll_seconds
            polled = await asyncio.to_thread(
                _poll_terminal_snapshot,
                task_id,
                project_id,
            )
            if polled is None:
                continue
            event, data = polled
            payload = json.dumps(data, ensure_ascii=False)
            yield f"event: {event}\ndata: {payload}\n\n"
            logger.debug(
                "SSE 终态快照查库命中: task_id=%d event=%s",
                task_id,
                event,
            )
            return

        payload = json.dumps(data, ensure_ascii=False)
        yield f"event: {event}\ndata: {payload}\n\n"
        if event in _TERMINAL_EVENTS:
            logger.debug("SSE 终态: task_id=%d event=%s", task_id, event)
            return


# 全局实例，挂到 app.state.event_bus
event_bus = _EventBus()


# ══════════════════════════════════════════════════════════════════════════════
# 请求/响应模型
# ══════════════════════════════════════════════════════════════════════════════


class CharacterImageGenerateRequest(BaseModel):
    """提交角色图片生成任务。"""

    # project_id 必填,它是归属校验的依据(见 _get_project_or_raise)。
    # 注:曾有 `user_id: int = Field(gt=0)`。归属者从 request.state.current_user 取,
    # 请求体里那个字段既不被读、又让调用方以为自己能指定归属者 —— 填别人的 id 不报错
    # 也不生效,正是本仓最忌讳的"看起来生效的错"。已删。
    project_id: int = Field(gt=0)
    reference_image_url: str | None = None
    prompt: str = ""
    negative_prompt: str = ""
    # 三个上界都直通付费调用,必须在契约层卡住:num_images 是 provider 调用次数的
    # 循环上界,一个已认证请求填个大数就能绕过按请求计的限流、把成本拉到无上限
    # (2026-08-10 机器审逮到)。宽高上界按当前 i2v 与像素化管线的实际处理范围取。
    width: int = Field(default=1024, ge=64, le=2048)
    height: int = Field(default=1024, ge=64, le=2048)
    num_images: int = Field(default=3, ge=1, le=4)
    direction: ActionDirection = ActionDirection.EAST


class CharacterDirectionSetGenerateRequest(BaseModel):
    """基于角色已确认母版生成项目规格要求的其余方向。"""

    model_config = ConfigDict(extra="forbid")
    project_id: int = Field(gt=0)
    character_id: int = Field(gt=0)
    prompt: str = ""
    negative_prompt: str = ""
    width: int = Field(default=1024, ge=64, le=2048)
    height: int = Field(default=1024, ge=64, le=2048)
    num_images: int = Field(default=3, ge=1, le=4)


class CharacterViewSheetGenerateRequest(BaseModel):
    """四向 / 八向立绘 sheet。两口字段相同,朝向集合由路径决定。"""

    model_config = ConfigDict(extra="forbid")
    project_id: int = Field(gt=0)
    character_id: int = Field(gt=0)
    prompt: str = ""
    negative_prompt: str = ""
    width: int = Field(default=1024, ge=64, le=2048)
    height: int = Field(default=1024, ge=64, le=2048)
    # sheet 比单张立绘贵,默认 1,不沿用 image 的 3。
    num_images: int = Field(default=1, ge=1, le=4)


class CharacterActionGenerateRequest(BaseModel):
    """提交角色动作生成任务。"""

    # project_id 必填,它是归属校验的依据(见 _get_project_or_raise)。
    # 注:曾有 `user_id: int = Field(gt=0)`。归属者从 request.state.current_user 取,
    # 请求体里那个字段既不被读、又让调用方以为自己能指定归属者 —— 填别人的 id 不报错
    # 也不生效,正是本仓最忌讳的"看起来生效的错"。已删。
    project_id: int = Field(gt=0)
    character_id: int = Field(gt=0)
    action_type: ActionType
    custom_prompt: str | None = None
    reference_video_url: str | None = None
    reference_image_urls: list[str] = Field(default_factory=list)
    # 同上:帧数决定抽帧与逐帧抠图的工作量,上界 64 已远超引擎能出的有效周期长度。
    # 不给则按动作类型取约定值(ACTION_FRAME_COUNTS)——写死一个默认值就等于替所有动作
    # 都答了同一个数,而待机与走路要的帧数本来就不同。
    num_frames: int | None = Field(default=None, ge=1, le=64)
    # ── action_type=custom 才用到(#239)───────────────────────────────────
    # 这个动作是否循环播放。不给则编排层兜成一次性,也不按描述文字猜 —— 两个方向的代价
    # 不对称:一次性动作被当成循环会让末帧接回首帧抽搐、产物不可用,反之只是不无缝闭环、
    # 仍可用。而且猜错是静默的,帧数/时长/成色全部正常、没有任何一道会红。
    loop: bool | None = None
    # 这个动作有没有地面接触。飞 / 游 / 攀全程离地,它们的包围盒底边是尾羽与爪子、逐帧在变,
    # 按脚线对齐反而让身体上下浮动(#534)。不给按"有"处理:误判成离地会让角色不站在地上,
    # 比浮动严重。jump 不走这个字段 —— 它腾空但要回地。
    ground_contact: bool | None = None
    # 视频模型。None = 用部署默认。取值域见 ModelRegistry.chain(CHARACTER_ACTION);
    # 非法值在入口就报错,不到付费调用才失败。选中的型号表示这次从它开始试。
    video_model: str | None = None
    # 这次动作属于哪个造型。给了才可能走三渲二 —— 3D 资产挂在造型一级(#121)。
    # 不给则照旧走 i2v(向后兼容:前端接上之前所有调用都是这样)。
    # 让**所有**动作生成都按造型定位外观是 #253,不在本改动范围内。
    outfit_id: str | None = None
    # 角色体型。决定"手臂/手肘"这类人体部位词能不能进提示词 —— 非双足角色的描述里出现
    # 它们,模型会凭空接上一对人的上肢,而帧数/时长/成色全部正常、没有一道会红。
    # 不给则按双足处理:这是绝大多数角色的实情,而误判成非双足会把合法描述拒掉。
    stance: CharacterStance | None = None
    direction: ActionDirection = ActionDirection.EAST

    @model_validator(mode="after")
    def require_custom_prompt(self):
        if self.action_type is ActionType.CUSTOM:
            prompt = (self.custom_prompt or "").strip()
            if not prompt:
                raise ValueError("custom 动作必须提供 custom_prompt")
            self.custom_prompt = prompt
        return self

    @model_validator(mode="after")
    def ground_contact_belongs_to_custom_only(self):
        # 写死的那几个动作都有地面接触,收下这个字段等于让调用方以为自己能改它。
        if self.action_type is not ActionType.CUSTOM and self.ground_contact is not None:
            raise ValueError(
                f"action_type={self.action_type.value} 不该带 ground_contact:"
                "它只对 custom 动作有意义,写死的动作都有地面接触"
            )
        return self

    @model_validator(mode="after")
    def drop_blank_reference_image_urls(self):
        # 执行阶段只取 reference_image_urls[0]。留着空串会让"有母版"的判定成立,
        # 却要等到下载那一步才炸 —— 两处口径必须一致,否则提交时的预检形同虚设。
        self.reference_image_urls = [
            url.strip() for url in self.reference_image_urls if url.strip()
        ]
        return self


class GenerationTaskOut(BaseModel):
    """生成任务响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int | None = None
    task_type: str
    status: str
    input_payload: dict | None = None
    result: dict | None = None
    error_message: str | None = None
    # pending:比本任务更早、别人未结束的条数;自己的单 / running / 终态为 0。
    queue_ahead: int = 0


def _task_to_out(session: Session, task: GenerationTask) -> GenerationTaskOut:
    """领域 dataclass → 响应模型。"""
    result_dict = None
    if task.result is not None:
        result_dict = dataclasses.asdict(task.result)
    return GenerationTaskOut(
        id=task.id,
        project_id=task.project_id,
        task_type=task.task_type.value,
        status=task.status.value,
        input_payload=task.input_payload,
        result=result_dict,
        error_message=task.error_message,
        queue_ahead=task_repo.queue_ahead_for(session, task),
    )


# ══════════════════════════════════════════════════════════════════════════════
# 端点
# ══════════════════════════════════════════════════════════════════════════════


def _require_video_model_allowed(model: str | None, user_id: int) -> None:
    """受限视频型号只对逐个列出的用户开放。

    在 HTTP 边界就拒:任务还没建、积分还没冻,拒起来干净。编排层另有同一道判定,
    那不是冗余 —— 任务可能被重排或重投,只在这里拦一次,绕过它的路径就直接花钱。
    """
    from windup_framework.gateway.registry import USER_GATED_MODELS, is_allowed_for_user

    if model in USER_GATED_MODELS and not is_allowed_for_user(model, user_id):
        raise BizException(f"视频模型 {model} 未对当前账号开放", code=403)


def _get_project_or_raise(
    session: Session,
    project_id: int,
    user_id: int,
) -> Project:
    """校验项目存在且属于 token 对应用户。"""
    project = session.get(Project, project_id)
    if project is None or project.user_id != user_id:
        raise BizException("项目不存在", code=BizCode.NOT_FOUND)
    return project


def _get_character_or_raise(
    session: Session,
    character_id: int,
    project_id: int,
) -> Character:
    """校验角色存在且属于本次生成所指定的项目。"""
    character = session.get(Character, character_id)
    if character is None or character.project_id != project_id:
        raise BizException("角色不存在", code=BizCode.NOT_FOUND)
    return character


def _outfit_model_3d_url(character: Character, outfit_id: str | None) -> str | None:
    """这个造型有没有绑骨 3D 模型 —— **三渲二的唯一判据**(#122)。

    判据在这里读 DB 而不是做成 ai_engine port 上的查询:引擎只吃 bytes、不碰存储。
    没给 ``outfit_id`` 就返回 None 照旧走 i2v,**不猜"那就用第一个造型吧"** —— 猜错
    等于拿另一个造型的模型渲这次的动作,角色穿错衣服而帧数、时长、成色全部正常。
    """
    if not outfit_id:
        return None
    try:
        data = CharacterData.model_validate(character.character_data or {})
    except ValidationError:
        # 结构对不上就当没有资产:这一步只决定"走哪条路线",不该因为 character_data
        # 里某个无关字段脏了就让整个动作生成起不来。走 i2v 仍然出得了帧。
        logger.warning(
            "character %s 的 character_data 解析失败,三渲二判据按无资产处理",
            character.id,
        )
        return None
    outfit = next((o for o in data.outfits if o.id == outfit_id), None)
    if outfit is None:
        raise BizException(f"造型 {outfit_id!r} 不属于该角色", code=BizCode.NOT_FOUND)
    return (outfit.model_3d_url or "").strip() or None


#: 一个 3D 资产下最多能有几个动作。
#:
#: 这条是**产品限额**不是技术限制:三渲二的动作由浏览器出帧,对我们几乎零成本,
#: 限的是本期试用范围。作用域取"每个 3D 资产"而不是"每个用户":动作是从模型生成
#: 出来的,换个模型就是另一批动作;按用户总数算的话,建了第二个模型却分不到名额。
#: 要改成按用户总数,把 ``_owned_3d_action_count`` 的统计范围换掉即可。
MAX_ACTIONS_PER_3D_ASSET = 3


def _require_3d_action_quota(character: Character, outfit_id: str | None) -> None:
    """三渲二动作的条数上限。**只管三渲二** —— i2v 那条路线不受此限。

    在 HTTP 边界就拒:任务还没建、积分还没冻,拒起来干净;而超限这件事与用户输入无关,
    让它走到执行阶段才失败的话,用户看到的是通用的"生成失败",不知道是撞了限额。
    """
    if not outfit_id:
        return
    try:
        data = CharacterData.model_validate(character.character_data or {})
    except ValidationError:
        # 与 ``_outfit_model_3d_url`` 同一个取舍:结构脏了不该让生成起不来。
        # 这里放行的后果只是少拦一次,而拦错的后果是用户被卡住且看不出原因。
        return
    outfit = next((o for o in data.outfits if o.id == outfit_id), None)
    if outfit is None or not (outfit.model_3d_url or "").strip():
        return                      # 没有 3D 资产 = 走 i2v,不归本闸管
    if len(outfit.actions) >= MAX_ACTIONS_PER_3D_ASSET:
        raise BizException(
            f"这个 3D 角色已经有 {len(outfit.actions)} 个动作了,"
            f"本期每个 3D 角色最多 {MAX_ACTIONS_PER_3D_ASSET} 个。"
            "删掉一个再来,或改走视频路线。",
            code=BizCode.BAD_REQUEST,
        )


def _character_stance(character: Character) -> CharacterStance | None:
    """角色存的体型;没存过就给 None(让下游用它自己的默认值)。

    返回 None 而不是直接给 BIPED:默认值只该由 ``CharacterCard.stance`` 定义一次。
    在这里再兜一个,就是第二真相源 —— 两处默认值一定会各自漂。

    ``character_data`` 是裸 dict(存量 96 个角色都没有这个键),按契约解析会因为别的
    字段不合规而整条炸掉,而这里只要一个字段。取不到就当没存过。
    """
    data = character.character_data
    if not isinstance(data, dict):
        return None
    raw = data.get("stance")
    if not isinstance(raw, str):
        return None
    try:
        return CharacterStance(raw)
    except ValueError:
        # 存了个不认识的值 —— 当没存过,别让一个脏字段挡住整条生成。
        logger.warning("角色 %s 的 stance=%r 不是合法取值,按未设置处理", character.id, raw)
        return None


def _require_master(model_3d_url: str | None, reference_image_urls: list[str]) -> None:
    """动作生成拿不到母版就当场拒收,不收下一个注定在执行阶段失败的任务。"""
    # 判据照抄执行器的取母版逻辑(``ActionTaskExecutor._produce_action``):有 3D 资产走
    # 三渲二吃 model_3d_url,否则走 i2v 只认 reference_image_urls[0]。
    # **不回落到 Character.reference_image_url** —— 执行器根本不读它,这里替它回落等于
    # 拿另一张图生成,而任务照样 COMPLETED、帧数成色全部正常,没有任何一道会红。
    if model_3d_url or reference_image_urls:
        return
    raise BizException(
        "缺少角色母版:请先完成定妆(生成并确认角色图),再带上确认后的母版图生成动作",
        code=BizCode.BAD_REQUEST,
    )


def _validate_project_size(project: Project, width: int, height: int) -> None:
    """校验输入尺寸与项目约束是否一致;不一致则抛异常。"""
    if width != project.sprite_width or height != project.sprite_height:
        raise BizException(
            f"输入尺寸 {width}×{height} 与项目约束 {project.sprite_width}×{project.sprite_height} 不一致",
            code=BizCode.BAD_REQUEST,
        )


def _validate_project_direction(project: Project, direction: ActionDirection) -> None:
    """只允许当前项目规格要求的真实方向进入生成队列。"""

    if not is_required_direction(project.directional_movement, direction):
        raise BizException(
            f"方向 {direction.value} 不属于当前项目的生成规格",
            code=BizCode.BAD_REQUEST,
        )


def _publish_generation_after_commit(
    session: Session,
    publisher: MqPublisher,
    *,
    task_id: int,
    task_type: str,
    dedupe_key: str | None = None,
) -> None:
    """注册 after_commit 回调:session 提交成功后再投递到 Redis Stream。"""
    msg_type = msg_type_for_generation(task_type)
    message_id = publisher.enqueue(
        session,
        stream=stream_for_msg_type(msg_type),
        msg_type=msg_type,
        payload={"task_id": task_id, "task_type": task_type},
        dedupe_key=dedupe_key or f"generation:{task_id}",
    )
    publisher.register_after_commit(session, message_id)


@router.post("/image", response_model=Response[GenerationTaskOut])
def submit_image_generation(
    body: CharacterImageGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交角色图片生成任务:建 PENDING 记录立即返回,实际图生图后台跑。"""
    user_id = request.state.current_user.id
    project = _get_project_or_raise(session, body.project_id, user_id)
    _validate_project_size(project, body.width, body.height)
    _validate_project_direction(project, body.direction)
    input_data = CharacterImageInput(
        reference_image_url=body.reference_image_url,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        width=body.width,
        height=body.height,
        num_images=body.num_images,
        direction=body.direction,
    )
    task = generation_service.generate_character_image(
        session,
        user_id=user_id,
        project_id=body.project_id,
        input=input_data,
    )
    # 生成任务要在 commit 之后再入队:任务行未提交时工作线程用自己的 session 读不到它,
    # update 会静默跳过,表现为任务永远停在 PENDING。
    _publish_generation_after_commit(
        session,
        request.app.state.mq_publisher,
        task_id=task.id,
        task_type=task.task_type.value,
    )
    return Response.success(_task_to_out(session, task), message="任务已提交")


@router.post("/image-set", response_model=Response[GenerationTaskOut])
def submit_direction_set_generation(
    body: CharacterDirectionSetGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交一个方向集任务；方向集合由项目规格唯一决定。"""
    user_id = request.state.current_user.id
    project = _get_project_or_raise(session, body.project_id, user_id)
    _validate_project_size(project, body.width, body.height)
    character = _get_character_or_raise(session, body.character_id, body.project_id)
    confirmed_master = (character.reference_image_url or "").strip()
    if not confirmed_master:
        raise BizException(
            "请先选择并确认角色母版，再生成四向或八向角色",
            code=BizCode.BAD_REQUEST,
        )
    input_data = CharacterDirectionSetInput(
        character_id=character.id,
        reference_image_url=confirmed_master,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        width=body.width,
        height=body.height,
        num_images=body.num_images,
        directions=list(
            required_directions_for_movement(project.directional_movement)
        ),
    )
    task = generation_service.generate_character_direction_set(
        session,
        user_id=user_id,
        project_id=body.project_id,
        input=input_data,
    )
    if not task.is_terminal:
        _publish_generation_after_commit(
            session,
            request.app.state.mq_publisher,
            task_id=task.id,
            task_type=task.task_type.value,
        )
    return Response.success(_task_to_out(session, task), message="方向集任务已提交")


def _submit_view_sheet(
    body: CharacterViewSheetGenerateRequest,
    request: Request,
    session: Session,
    *,
    expected_movement: int,
    label: str,
    submit,
) -> Response[GenerationTaskOut]:
    user_id = request.state.current_user.id
    project = _get_project_or_raise(session, body.project_id, user_id)
    if project.directional_movement != expected_movement:
        raise BizException(f"当前项目不是{label}", code=BizCode.BAD_REQUEST)
    _validate_project_size(project, body.width, body.height)
    character = _get_character_or_raise(session, body.character_id, body.project_id)
    confirmed_master = (character.reference_image_url or "").strip()
    if not confirmed_master:
        raise BizException("请先选择并确认角色母版", code=BizCode.BAD_REQUEST)
    input_data = CharacterViewSheetInput(
        character_id=character.id,
        reference_image_url=confirmed_master,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        width=body.width,
        height=body.height,
        num_images=body.num_images,
    )
    task = submit(
        session,
        user_id=user_id,
        project_id=body.project_id,
        input=input_data,
    )
    _publish_generation_after_commit(
        session,
        request.app.state.mq_publisher,
        task_id=task.id,
        task_type=task.task_type.value,
    )
    return Response.success(_task_to_out(session, task), message="任务已提交")


@router.post("/four-view", response_model=Response[GenerationTaskOut])
def submit_four_view_generation(
    body: CharacterViewSheetGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交四向立绘 sheet:正视母版转出十字四格,斜向留空。"""
    return _submit_view_sheet(
        body,
        request,
        session,
        expected_movement=2,
        label="四向",
        submit=generation_service.generate_character_four_view,
    )


@router.post("/eight-view", response_model=Response[GenerationTaskOut])
def submit_eight_view_generation(
    body: CharacterViewSheetGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交八向立绘 sheet:正视母版转出八角,中心留空。"""
    return _submit_view_sheet(
        body,
        request,
        session,
        expected_movement=3,
        label="八向",
        submit=generation_service.generate_character_eight_view,
    )


@router.post("/action", response_model=Response[GenerationTaskOut])
def submit_action_generation(
    body: CharacterActionGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交角色动作生成任务:建 PENDING 记录立即返回,实际生成后台跑。"""
    user_id = request.state.current_user.id
    _require_video_model_allowed(body.video_model, user_id)
    project = _get_project_or_raise(session, body.project_id, user_id)
    _validate_project_direction(project, body.direction)
    character = _get_character_or_raise(session, body.character_id, body.project_id)
    model_3d_url = _outfit_model_3d_url(character, body.outfit_id)
    _require_3d_action_quota(character, body.outfit_id)
    _require_master(model_3d_url, body.reference_image_urls)
    input_data = CharacterActionInput(
        character_id=body.character_id,
        action_type=body.action_type,
        custom_prompt=body.custom_prompt,
        loop=body.loop,
        ground_contact=body.ground_contact,
        video_model=body.video_model,
        reference_video_url=body.reference_video_url,
        reference_image_urls=body.reference_image_urls,
        num_frames=body.num_frames,
        outfit_id=body.outfit_id,
        direction=body.direction,
        # 路线选择在这里定死并写进入参,而不是留给编排层现查:这样"这次走的哪条路线"
        # 在任务入参上就是可见的,排查时不用去猜当时 DB 是什么状态。
        model_3d_url=model_3d_url,
        # 请求没显式给就取角色上存的那个。与 model_3d_url 同一个模式:web 层读
        # character_data、写进入参,这样"这次按什么体型算的"在任务入参上就是可见的,
        # 排查时不用去猜当时 DB 是什么状态。
        #
        # 请求优先于角色:前者是这次生成的显式意图(脚本 / 调试会用),而角色上那个是
        # 常态。反过来的话,角色一旦存错就没有任何办法单次绕过。
        stance=body.stance if body.stance is not None else _character_stance(character),
    )
    task = generation_service.generate_character_action(
        session,
        user_id=user_id,
        project_id=body.project_id,
        input=input_data,
    )
    _publish_generation_after_commit(
        session,
        request.app.state.mq_publisher,
        task_id=task.id,
        task_type=task.task_type.value,
    )
    return Response.success(_task_to_out(session, task), message="任务已提交")


@router.get("/tasks/{task_id}", response_model=Response[GenerationTaskOut])
def get_task(
    task_id: int,
    project_id: int = Query(..., gt=0),
    request: Request = None,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """查询生成任务状态与结果。"""
    user_id = request.state.current_user.id
    _get_project_or_raise(session, project_id, user_id)
    task = task_repo.get_task(session, task_id)
    if task is None or task.project_id != project_id:
        # 归属两道,与 stream_task 同口径:只查项目不够,任意已认证用户拿自己的
        # project_id 配上别人的 task_id 就能读到别人的产物 URL。
        raise BizException("任务不存在", code=BizCode.NOT_FOUND)
    return Response.success(_task_to_out(session, task))


@router.post(
    "/tasks/{task_id}/retry-failed-directions",
    response_model=Response[GenerationTaskOut],
)
def retry_failed_directions(
    task_id: int,
    project_id: int = Query(..., gt=0),
    request: Request = None,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """只重试方向集内的失败方向；已成功方向不再执行和计费。"""
    user_id = request.state.current_user.id
    _get_project_or_raise(session, project_id, user_id)
    task = task_repo.get_task_by_user(session, user_id, task_id)
    if task is None or task.project_id != project_id:
        raise BizException("任务不存在", code=BizCode.NOT_FOUND)
    try:
        restarted = generation_service.retry_failed_directions(session, task=task)
    except ValueError as exc:
        raise BizException(str(exc), code=BizCode.BAD_REQUEST) from exc
    _publish_generation_after_commit(
        session,
        request.app.state.mq_publisher,
        task_id=restarted.id,
        task_type=restarted.task_type.value,
        dedupe_key=(
            f"generation:{restarted.id}:retry:"
            f"{billing.attempt_for_task(restarted.task_type, restarted.input_payload)}"
        ),
    )
    return Response.success(_task_to_out(session, restarted), message="失败方向已重新提交")


@router.get("/tasks/{task_id}/stream")
async def stream_task(
    task_id: int,
    request: Request,
    project_id: int = Query(..., gt=0),
) -> StreamingResponse:
    """SSE:实时推送任务进度与最终结果。

    事件类型:
      - ``progress``: 生成进度 (stage/current/total/note)
      - ``completed``: 任务完成,携带最终结果
      - ``partial``: 方向集部分失败,携带已成功方向与失败方向
      - ``failed``: 任务失败,携带错误信息

    若客户端订阅时任务已处于终态,立即推送终态事件并关闭连接。

    归属是**两道**(2026-08-11 补齐,此前是一行 TODO):项目要属于当前用户
    (``_get_project_or_raise``),任务还要属于那个项目。只查项目不够 —— 任意已认证用户
    拿自己的 project_id 配上别人的 task_id 就能订阅到别人的流,而事件体里带 result,
    即最终帧的对象存储 URL。两道都必须在 ``subscribe`` **之前**:放之后的话越权请求仍会
    在 EventBus 上挂一个订阅者(照样收事件、只是响应体被丢弃),订阅表还会因为没人
    unsubscribe 而增长。

    鉴权/读库走短 session(见 :func:`_load_stream_start`),推流期间不占连接池。
    """
    user_id = request.state.current_user.id
    # 终态快照要在订阅前读,订阅要紧跟其后 —— 两者之间若任务刚好终结,事件会丢。
    # 反过来(先订阅后读)则会重复发一次终态,客户端拿到两条 completed。
    terminal_event, terminal_payload = _load_stream_start(
        user_id=user_id,
        project_id=project_id,
        task_id=task_id,
    )

    queue = await event_bus.subscribe(project_id, task_id)
    logger.debug("SSE 订阅: task_id=%d project_id=%d", task_id, project_id)

    async def _event_generator():
        try:
            if terminal_event is not None:
                payload = json.dumps(terminal_payload, ensure_ascii=False)
                yield f"event: {terminal_event}\ndata: {payload}\n\n"
                return
            async for message in _stream_events(
                request=request,
                queue=queue,
                task_id=task_id,
                project_id=project_id,
            ):
                yield message
        finally:
            await event_bus.unsubscribe(project_id, task_id, queue)
            logger.debug("SSE 取消订阅: task_id=%d", task_id)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
