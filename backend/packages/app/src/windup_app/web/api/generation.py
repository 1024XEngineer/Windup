"""生成任务 API。

契约层：定义前端请求/响应的 Pydantic 模型，与 server 层解耦。
实际逻辑由 server 层实现，本文件只做参数校验和格式转换。

端点一览
--------
POST /generation/image                     提交角色图片生成任务
POST /generation/action                    提交角色动作生成任务
GET  /generation/tasks/{task_id}           查询任务状态
GET  /generation/tasks/{task_id}/stream    SSE 订阅任务进度
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
from collections import defaultdict

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from windup_common.enums.biz_code import BizCode
from windup_common.exceptions import BizException
from windup_common.models import CharacterStance
from windup_common.result import Response
from windup_framework.db import get_session
from windup_framework.db.session import SessionLocal
from windup_framework.mq.publisher import MqPublisher

from windup_app.server.character.model import Character, CharacterData
from windup_app.server.orchestrator import task_repo
from windup_app.server.mq.catalog import (
    GENERATION_STREAM,
    MSG_TYPE_CHARACTER_ACTION,
    MSG_TYPE_CHARACTER_IMAGE,
)
from windup_app.server.orchestrator.service import service as generation_service
from windup_app.server.orchestrator.model import (
    ActionType,
    CharacterActionInput,
    CharacterImageInput,
    GenerationTask,
)
from windup_app.server.project.model import Project

logger = logging.getLogger("windup.generation.api")

router = APIRouter(prefix="/generation", tags=["generation"])


# ══════════════════════════════════════════════════════════════════════════════
# EventBus（任务进度推送）
# ══════════════════════════════════════════════════════════════════════════════

# 心跳间隔(秒)
_HEARTBEAT_TIMEOUT = 30.0

# 终态事件
_TERMINAL_EVENTS = {"completed", "failed"}


def _poll_terminal_snapshot(task_id: int, project_id: int) -> tuple[str, dict] | None:
    """SSE heartbeat 查库兜底：Pub/Sub 断线期间错过的终态由此补发。"""
    session = SessionLocal()
    try:
        return task_repo.terminal_snapshot(session, task_id, project_id)
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

    def __init__(self) -> None:
        # 键是 (project_id, task_id):同一个 task_id 在不同项目下互不串流(主线 #110)。
        # 值是 (queue, 它所属的 loop):不同订阅者可能来自不同 loop(多 worker / 测试里的
        # 临时 loop),不能只存一个全局 loop —— 见 publish 里的 call_soon_threadsafe。
        self._queues: dict[
            tuple[int, int], list[tuple[asyncio.Queue, asyncio.AbstractEventLoop]]
        ] = defaultdict(list)

    async def subscribe(self, project_id: int, task_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._queues[(project_id, task_id)].append((queue, asyncio.get_running_loop()))
        return queue

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
            here = None                       # 从没有 loop 的生成工作线程调用

        for queue, loop in list(self._queues.get((project_id, task_id), [])):
            if loop is here:
                # 同一个 loop 内:直接入队。**不能一律走 call_soon_threadsafe** —— 那是
                # 异步调度,要等 loop 下一次迭代才真入队,于是"publish 完立刻 get_nowait"
                # 会拿到空队列(主线 #110 的隔离用例正是这么写的)。
                queue.put_nowait((event, data))
                continue
            try:
                loop.call_soon_threadsafe(queue.put_nowait, (event, data))
            except RuntimeError:
                # loop 已关闭(客户端断连后请求 loop 结束)。丢弃即可 —— 没有订阅者在等
                # 这条消息,而任务状态本身已落库,重连后靠 GET /tasks/{id} 取。
                logger.debug("SSE loop 已关闭,丢弃事件 task_id=%d event=%s", task_id, event)


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
    num_frames: int = Field(default=16, ge=1, le=64)
    # ── action_type=custom 才用到(#239)───────────────────────────────────
    # 这个动作是否循环播放。不给则编排层兜成一次性,也不按描述文字猜 —— 两个方向的代价
    # 不对称:一次性动作被当成循环会让末帧接回首帧抽搐、产物不可用,反之只是不无缝闭环、
    # 仍可用。而且猜错是静默的,帧数/时长/成色全部正常、没有任何一道会红。
    loop: bool | None = None
    # 视频模型。None = 用部署默认(kling-v2-5-turbo)。取值域见
    # orchestrator.executor.ALLOWED_VIDEO_MODELS;非法值在入口就报错,不到付费调用才失败。
    video_model: str | None = None
    # 这次动作属于哪个造型。给了才可能走三渲二 —— 3D 资产挂在造型一级(#121)。
    # 不给则照旧走 i2v(向后兼容:前端接上之前所有调用都是这样)。
    # 让**所有**动作生成都按造型定位外观是 #253,不在本改动范围内。
    outfit_id: str | None = None
    # 角色体型。决定"手臂/手肘"这类人体部位词能不能进提示词 —— 非双足角色的描述里出现
    # 它们,模型会凭空接上一对人的上肢,而帧数/时长/成色全部正常、没有一道会红。
    # 不给则按双足处理:这是绝大多数角色的实情,而误判成非双足会把合法描述拒掉。
    stance: CharacterStance | None = None

    @model_validator(mode="after")
    def require_custom_prompt(self):
        if self.action_type is ActionType.CUSTOM:
            prompt = (self.custom_prompt or "").strip()
            if not prompt:
                raise ValueError("custom 动作必须提供 custom_prompt")
            self.custom_prompt = prompt
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


def _task_to_out(task: GenerationTask) -> GenerationTaskOut:
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
    )


# ══════════════════════════════════════════════════════════════════════════════
# 端点
# ══════════════════════════════════════════════════════════════════════════════


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
        logger.warning("character %s 的 character_data 解析失败,三渲二判据按无资产处理",
                       character.id)
        return None
    outfit = next((o for o in data.outfits if o.id == outfit_id), None)
    if outfit is None:
        raise BizException(f"造型 {outfit_id!r} 不属于该角色", code=BizCode.NOT_FOUND)
    return (outfit.model_3d_url or "").strip() or None


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


def _publish_generation_after_commit(
    session: Session,
    publisher: MqPublisher,
    *,
    task_id: int,
    task_type: str,
) -> None:
    """注册 after_commit 回调:session 提交成功后再投递到 Redis Stream。"""
    msg_type = (
        MSG_TYPE_CHARACTER_IMAGE
        if task_type == MSG_TYPE_CHARACTER_IMAGE
        else MSG_TYPE_CHARACTER_ACTION
    )
    message_id = publisher.enqueue(
        session,
        stream=GENERATION_STREAM,
        msg_type=msg_type,
        payload={"task_id": task_id, "task_type": task_type},
        dedupe_key=f"generation:{task_id}",
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
    input_data = CharacterImageInput(
        reference_image_url=body.reference_image_url,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt,
        width=body.width,
        height=body.height,
        num_images=body.num_images,
    )
    task = generation_service.generate_character_image(
        session, user_id=user_id, project_id=body.project_id, input=input_data,
    )
    # 生成任务要在 commit 之后再入队:任务行未提交时工作线程用自己的 session 读不到它,
    # update 会静默跳过,表现为任务永远停在 PENDING。
    _publish_generation_after_commit(
        session,
        request.app.state.mq_publisher,
        task_id=task.id,
        task_type=task.task_type.value,
    )
    return Response.success(_task_to_out(task), message="任务已提交")


@router.post("/action", response_model=Response[GenerationTaskOut])
def submit_action_generation(
    body: CharacterActionGenerateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response[GenerationTaskOut]:
    """提交角色动作生成任务:建 PENDING 记录立即返回,实际生成后台跑。"""
    user_id = request.state.current_user.id
    _get_project_or_raise(session, body.project_id, user_id)
    character = _get_character_or_raise(session, body.character_id, body.project_id)
    model_3d_url = _outfit_model_3d_url(character, body.outfit_id)
    _require_master(model_3d_url, body.reference_image_urls)
    input_data = CharacterActionInput(
        character_id=body.character_id,
        action_type=body.action_type,
        custom_prompt=body.custom_prompt,
        loop=body.loop,
        video_model=body.video_model,
        reference_video_url=body.reference_video_url,
        reference_image_urls=body.reference_image_urls,
        num_frames=body.num_frames,
        outfit_id=body.outfit_id,
        # 路线选择在这里定死并写进入参,而不是留给编排层现查:这样"这次走的哪条路线"
        # 在任务入参上就是可见的,排查时不用去猜当时 DB 是什么状态。
        model_3d_url=model_3d_url,
        stance=body.stance,
    )
    task = generation_service.generate_character_action(
        session, user_id=user_id, project_id=body.project_id, input=input_data,
    )
    _publish_generation_after_commit(
        session,
        request.app.state.mq_publisher,
        task_id=task.id,
        task_type=task.task_type.value,
    )
    return Response.success(_task_to_out(task), message="任务已提交")


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
    return Response.success(_task_to_out(task))


@router.get("/tasks/{task_id}/stream")
async def stream_task(
    task_id: int,
    request: Request,
    project_id: int = Query(..., gt=0),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """SSE:实时推送任务进度与最终结果。

    事件类型:
      - ``progress``: 生成进度 (stage/current/total/note)
      - ``completed``: 任务完成,携带最终结果
      - ``failed``: 任务失败,携带错误信息

    若客户端订阅时任务已处于终态,立即推送终态事件并关闭连接。

    归属是**两道**(2026-08-11 补齐,此前是一行 TODO):项目要属于当前用户
    (``_get_project_or_raise``),任务还要属于那个项目。只查项目不够 —— 任意已认证用户
    拿自己的 project_id 配上别人的 task_id 就能订阅到别人的流,而事件体里带 result,
    即最终帧的对象存储 URL。两道都必须在 ``subscribe`` **之前**:放之后的话越权请求仍会
    在 EventBus 上挂一个订阅者(照样收事件、只是响应体被丢弃),订阅表还会因为没人
    unsubscribe 而增长。
    """
    user_id = request.state.current_user.id
    _get_project_or_raise(session, project_id, user_id)
    task = task_repo.get_task(session, task_id)
    if task is None or task.project_id != project_id:
        raise BizException("任务不存在", code=BizCode.NOT_FOUND)

    # 终态快照要在订阅前读,订阅要紧跟其后 —— 两者之间若任务刚好终结,事件会丢。
    # 反过来(先订阅后读)则会重复发一次终态,客户端拿到两条 completed。
    terminal_event = task_repo.terminal_event_for(task)

    queue = await event_bus.subscribe(project_id, task_id)
    logger.debug("SSE 订阅: task_id=%d project_id=%d", task_id, project_id)

    async def _event_generator():
        try:
            if terminal_event is not None:
                payload = json.dumps(task_repo.task_event_payload(task), ensure_ascii=False)
                yield f"event: {terminal_event}\ndata: {payload}\n\n"
                return
            while True:
                if await request.is_disconnected():
                    logger.debug("SSE 客户端断开: task_id=%d", task_id)
                    break
                try:
                    event, data = await asyncio.wait_for(
                        queue.get(),
                        timeout=_HEARTBEAT_TIMEOUT,
                    )
                    payload = json.dumps(data, ensure_ascii=False)
                    yield f"event: {event}\ndata: {payload}\n\n"
                    if event in _TERMINAL_EVENTS:
                        logger.debug("SSE 终态: task_id=%d event=%s", task_id, event)
                        break
                except asyncio.TimeoutError:
                    polled = await asyncio.to_thread(
                        _poll_terminal_snapshot,
                        task_id,
                        project_id,
                    )
                    if polled is not None:
                        event, data = polled
                        payload = json.dumps(data, ensure_ascii=False)
                        yield f"event: {event}\ndata: {payload}\n\n"
                        logger.debug(
                            "SSE heartbeat 查库命中终态: task_id=%d event=%s",
                            task_id,
                            event,
                        )
                        break
                    yield ": heartbeat\n\n"
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
