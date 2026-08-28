"""动作 i2v 等待态:挂起、探活、启动恢复。

Redis hash 与 ZSET 延迟队列的细节留在本模块;executor 只处理
Completed / AwaitingVideo / Failed。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from windup_app.server.mq.catalog import MSG_TYPE_CHARACTER_ACTION_POLL, stream_for_msg_type
from windup_app.server.mq.i2v_state import (
    I2V_FIRST_POLL_S,
    I2V_MAX_WAIT_S,
    I2V_POLL_INTERVAL_S,
    delete_i2v_state,
    load_i2v_state,
    save_i2v_state,
)
from windup_framework.mq.delayed import schedule_delayed

logger = logging.getLogger("windup.generation.i2v_poll")


class ActionAwaitingVideo(Exception):
    """i2v 已建单,任务保持 RUNNING,等 ZSET 到期后再探,不占 action worker。"""


@dataclass(frozen=True)
class Waiting:
    """仍在上游生成,已重新挂单。"""


@dataclass(frozen=True)
class Ready:
    video: bytes
    route_id: str | None


def _job_fields(job: object) -> tuple[str, str, str]:
    if isinstance(job, dict):
        return (
            str(job.get("job_id") or ""),
            str(job.get("route_id") or ""),
            str(job.get("model") or ""),
        )
    if isinstance(job, str):
        return job, "", ""
    return (
        str(getattr(job, "job_id", "") or ""),
        str(getattr(job, "route_id", "") or ""),
        str(getattr(job, "model", "") or ""),
    )


def _poll_dedupe(task_id: int, poll_count: int) -> str:
    return f"generation:{task_id}:poll:{poll_count}"


def _poll_payload(task_id: int, poll_count: int) -> dict[str, Any]:
    return {
        "task_id": task_id,
        "task_type": "character_action",
        "poll_count": poll_count,
    }


def schedule(
    task_id: int,
    job: object,
    *,
    poll_count: int,
    next_wait: float | None = None,
    started_at: float | None = None,
) -> None:
    """写入等待态并往延迟队列挂一次探活。"""
    job_id, route_id, model = _job_fields(job)
    wait = I2V_FIRST_POLL_S if next_wait is None else next_wait
    save_i2v_state(
        task_id,
        job_id=job_id,
        poll_count=poll_count,
        next_wait=wait,
        started_at=started_at,
        route_id=route_id,
        model=model,
    )
    schedule_delayed(
        delay_s=wait,
        stream=stream_for_msg_type(MSG_TYPE_CHARACTER_ACTION_POLL),
        msg_type=MSG_TYPE_CHARACTER_ACTION_POLL,
        payload=_poll_payload(task_id, poll_count),
        dedupe_key=_poll_dedupe(task_id, poll_count),
    )


def inspect(
    task_id: int,
    *,
    poll_video: Callable[..., bytes | None],
) -> Ready | Waiting:
    """探一次上游。未完成则再挂单并返回 Waiting;完成则返回 Ready。

    超时也先 poll 一次：成片已就绪就交付，避免网关最终成功却把任务写成失败。
    等待态被其它轮询清掉时返回 Waiting，不把任务打失败。
    """
    state = load_i2v_state(task_id)
    if state is None or not state.get("job_id"):
        logger.info("任务 %s 无 i2v 状态，视为已被其它轮询接管", task_id)
        return Waiting()

    elapsed = time.time() - float(state["started_at"] or 0)
    timed_out = elapsed >= I2V_MAX_WAIT_S

    route_id = state.get("route_id") or None
    # 型号早就随建单一起存进 Redis 了(见 save_i2v_state),但此前没往下传:
    # kling 系只有一个协议面,不传也查得到单;veo 的单在另一条路径上,不传就是 404,
    # 而单已经建了、钱已经花了。
    video = poll_video(
        state["job_id"], route_id=route_id, model=state.get("model") or None
    )
    if video is not None:
        return Ready(video=video, route_id=route_id)
    if timed_out:
        raise RuntimeError("i2v 未取得视频 URL(超时或失败)")
    nxt = min(float(state["next_wait"]) * 2, I2V_POLL_INTERVAL_S)
    schedule(
        task_id,
        {
            "job_id": state["job_id"],
            "route_id": state.get("route_id") or "",
            "model": state.get("model") or "",
        },
        poll_count=int(state["poll_count"]) + 1,
        next_wait=nxt,
        started_at=float(state["started_at"]),
    )
    return Waiting()


def clear(task_id: int) -> None:
    delete_i2v_state(task_id)


def reschedule_if_waiting(task_id: int, *, delay_s: float = 1) -> bool:
    """RUNNING 且仍有等待态:补一条即将到期的探活,不当孤儿失败。"""
    state = load_i2v_state(task_id)
    if state is None or not state.get("job_id"):
        return False
    poll_count = int(state.get("poll_count") or 0)
    schedule_delayed(
        delay_s=delay_s,
        stream=stream_for_msg_type(MSG_TYPE_CHARACTER_ACTION_POLL),
        msg_type=MSG_TYPE_CHARACTER_ACTION_POLL,
        payload=_poll_payload(task_id, poll_count),
        dedupe_key=_poll_dedupe(task_id, poll_count),
    )
    logger.info("RUNNING 任务仍在等 i2v,已补延迟轮询 | task_id=%s", task_id)
    return True
