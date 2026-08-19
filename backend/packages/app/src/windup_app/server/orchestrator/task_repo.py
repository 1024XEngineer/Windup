"""生成任务数据访问层。

纯 CRUD 操作，不含业务逻辑。所有函数接收 ``session: Session``，
由调用方（FastAPI ``get_session`` 依赖）管理事务边界——本模块只
``flush`` 不 ``commit``。

状态变更时自动向 EventBus 推送完整 task 数据（若已绑定），
供 SSE 端点实时推送给前端，替代轮询。
"""

from __future__ import annotations

import dataclasses
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from windup_app.server.orchestrator.model import (
    CharacterActionOutput,
    CharacterImageOutput,
    GenerationTask,
    GenerationTaskRecord,
    GenerationType,
    TaskStatus,
)

logger = logging.getLogger("windup.task_repo")

# 任务事件发布器（bootstrap / worker 中绑定，避免循环导入）
_task_event_publisher = None


def bind_task_event_publisher(publisher) -> None:
    """绑定 TaskEventPublisher（Redis bridge 或测试用 in-process）。"""
    global _task_event_publisher
    _task_event_publisher = publisher


def bind_event_bus(event_bus) -> None:
    """兼容旧调用：将 EventBus 包装为 in-process publisher。"""
    from windup_framework.sse.bridge import InProcessTaskEventBridge

    bind_task_event_publisher(
        InProcessTaskEventBridge(
            lambda project_id, task_id, event, data: event_bus.publish(
                project_id, task_id, event, data,
            ),
        ),
    )


# 状态 → SSE 事件名。终态必须用独立事件名:web 层的 stream 靠事件名判断何时收尾
# (``_TERMINAL_EVENTS``),一律发 "task_update" 的话那个判断永不成立 —— 客户端收到
# completed 之后连接仍开着,只能靠心跳挂到超时,而端点带 retry: 3000,浏览器原生
# EventSource 会每 3 秒重连、每次重收同一条 completed(2026-08-10 机器审逮到)。
_STATUS_EVENT = {
    TaskStatus.COMPLETED.value: "completed",
    TaskStatus.FAILED.value: "failed",
}


def task_event_payload(task: GenerationTask) -> dict:
    """SSE 事件体。**只有这一份实现**。

    抽成公开函数是因为有第二个发送点:SSE 端点在订阅时若发现任务已是终态,要立即补发
    一条终态事件。那里再抄一份字段列表就是第二个真相源 —— 加字段时漏掉一处,客户端
    会拿到形状不一致的两种同名事件。
    """
    return {
        "id": task.id,
        "user_id": task.user_id,
        "project_id": task.project_id,
        "task_type": task.task_type.value,
        "status": task.status.value,
        "input_payload": task.input_payload,
        "result": dataclasses.asdict(task.result) if task.result else None,
        "error_message": task.error_message,
    }


def terminal_event_for(task: GenerationTask) -> str | None:
    """任务已处于终态时对应的事件名;非终态返回 None。"""
    return _STATUS_EVENT.get(task.status.value)


def terminal_snapshot(
    session: Session,
    task_id: int,
    project_id: int,
) -> tuple[str, dict] | None:
    """若任务已终态，返回 (event, payload)；否则 None。供 SSE heartbeat 查库兜底。"""
    task = get_task(session, task_id)
    if task is None or task.project_id != project_id:
        return None
    event = terminal_event_for(task)
    if event is None:
        return None
    return event, task_event_payload(task)


def _publish_task_update(task_id: int, task: GenerationTask) -> None:
    """将完整 task 推送到 EventBus（若有订阅者）。

    EventBus 的键是 ``(project_id, task_id)``(主线 #110:同一 task_id 在不同项目下互不
    串流)。所以 ``task.project_id`` 为空时**发不到任何订阅者** —— 订阅方拿的键一定带
    着一个真实的 project_id。这种情况记 warning 而不是静默 publish 到一个没人听的键上:
    静默发出去的话,现象是"任务确实在跑、状态也在落库,但前端进度条一动不动",
    而日志里一行异常都没有。
    """
    if _task_event_publisher is None:
        return
    if task.project_id is None:
        logger.warning(
            "任务 %d 没有 project_id,SSE 事件无法投递(EventBus 按 (project_id, task_id) 索引)",
            task_id,
        )
        return
    event = _STATUS_EVENT.get(task.status.value, "task_update")
    _task_event_publisher.publish(
        task.project_id,
        task_id,
        event,
        task_event_payload(task),
    )


# ── 写入 ─────────────────────────────────────────────────────────────────


def create_task(
    session: Session,
    *,
    user_id: int,
    project_id: int | None,
    task_type: GenerationType,
    input_payload: dict,
) -> GenerationTask:
    """创建生成任务记录，返回领域对象。"""
    record = GenerationTaskRecord(
        user_id=user_id,
        project_id=project_id,
        task_type=task_type.value,
        status=TaskStatus.PENDING.value,
        input_payload=input_payload,
    )
    session.add(record)
    session.flush()
    return _record_to_domain(record)


def update_status(
    session: Session,
    task_id: int,
    status: TaskStatus,
    *,
    error_message: str | None = None,
) -> None:
    """更新任务状态（可选附带错误信息）。"""
    record = session.get(GenerationTaskRecord, task_id)
    if record is None:
        return
    record.status = status.value
    record.error_message = error_message
    record.update_at = datetime.now(timezone.utc)
    session.flush()
    _publish_task_update(task_id, _record_to_domain(record))


def update_result(
    session: Session,
    task_id: int,
    result_type: str,
    result: dict,
) -> None:
    """写入任务结果。"""
    record = session.get(GenerationTaskRecord, task_id)
    if record is None:
        return
    record.result_type = result_type
    record.result = result
    record.status = TaskStatus.COMPLETED.value
    record.update_at = datetime.now(timezone.utc)
    session.flush()
    _publish_task_update(task_id, _record_to_domain(record))


# ── 读取 ─────────────────────────────────────────────────────────────────


def get_task(session: Session, task_id: int) -> GenerationTask | None:
    """按 task_id 查询任务。"""
    record = session.get(GenerationTaskRecord, task_id)
    if record is None:
        return None
    return _record_to_domain(record)


def get_task_by_user(
    session: Session,
    user_id: int,
    task_id: int,
) -> GenerationTask | None:
    """按 user_id + task_id 查询（校验归属）。"""
    stmt = select(GenerationTaskRecord).where(
        GenerationTaskRecord.id == task_id,
        GenerationTaskRecord.user_id == user_id,
    )
    record = session.scalar(stmt)
    if record is None:
        return None
    return _record_to_domain(record)


def list_by_status(
    session: Session, statuses: tuple[TaskStatus, ...],
) -> list[GenerationTask]:
    """按状态列出任务（启动对账用）。"""
    values = [status.value for status in statuses]
    rows = session.scalars(
        select(GenerationTaskRecord).where(GenerationTaskRecord.status.in_(values))
    ).all()
    return [_record_to_domain(record) for record in rows]


# ── 转换 ─────────────────────────────────────────────────────────────────


def _record_to_domain(record: GenerationTaskRecord) -> GenerationTask:
    """ORM 记录 → 领域 dataclass。"""
    result = _deserialize_result(record.result_type, record.result)
    return GenerationTask(
        id=record.id,
        user_id=record.user_id,
        project_id=record.project_id,
        task_type=GenerationType(record.task_type),
        status=TaskStatus(record.status),
        input_payload=record.input_payload,
        result=result,
        error_message=record.error_message,
        create_at=record.create_at,
        update_at=record.update_at,
    )


def _deserialize_result(
    result_type: str | None,
    raw: dict | None,
) -> CharacterImageOutput | CharacterActionOutput | None:
    """根据 ``result_type`` 将 JSON dict 反序列化为对应的 dataclass。"""
    if raw is None or result_type is None:
        return None
    if result_type == "character_image":
        return CharacterImageOutput(
            type=raw.get("type", "character_image"),
            image_urls=raw.get("image_urls", []),
        )
    if result_type == "character_action":
        from windup_app.server.orchestrator.model import CharacterActionFrame

        frames = [
            CharacterActionFrame(
                index=f["index"],
                image_url=f["image_url"],
                duration_ms=f.get("duration_ms"),
            )
            for f in raw.get("frames", [])
        ]
        return CharacterActionOutput(
            type=raw.get("type", "character_action"),
            action_type=raw.get("action_type", ""),
            frames=frames,
            judge=raw.get("judge"),
            quality=raw.get("quality"),
            prompt_version=raw.get("prompt_version"),
        )
    return None
