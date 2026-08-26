"""动作任务等浏览器出帧时的 Redis 状态。

任务行保持 RUNNING,worker 立刻让出:出帧那一段在用户浏览器里跑,应用机既不起
Chromium 也不吃软件光栅那 7.6 个核(Refs #714)。

帧走 Redis 而不是对象存储:API 与 worker 在不同容器里,交接必须过共享存储;
实测单帧 1536×2560 的 PNG 是 178–209KB(透明底 + 平涂压得住),一个 32 帧动作
约 6–7MB,放 Redis 短时中转比多两跳对象存储上下行便宜。base64 是因为全站
Redis 连接池开着 ``decode_responses=True``。
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import time
from dataclasses import asdict, dataclass

from windup_app.server.mq.catalog import (
    GENERATION_STREAM,
    MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE,
)
from windup_framework.db.redis import get_redis
from windup_framework.mq.delayed import schedule_delayed

KEY_PREFIX = "windup:clientbake:"
STATE_TTL_S = 2 * 3600
# 浏览器没交帧就判失败的期限。比 i2v 的 30 分钟短:那边等的是上游算力,这边等的是
# 一个开着的页面 —— 关标签 / 切后台 / 手机 WebGL 起不来都不会有任何回报,拖着只是
# 占着一笔冻结积分。
DEADLINE_S = float(os.getenv("WINDUP_RENDER3D_CLIENT_BAKE_DEADLINE_S", "900"))
# 单帧上限。实测 178–209KB,给到 2MB 是 10 倍余量;超过它一定不是本管线的帧。
MAX_FRAME_BYTES = 2 * 1024 * 1024

REASON_FRAMES = "frames"
REASON_TIMEOUT = "timeout"
REASON_CLIENT_FAILED = "client_failed"


class ActionAwaitingClientBake(Exception):
    """出帧任务已挂给浏览器,任务保持 RUNNING,不占 action worker。"""


class ClientBakeError(RuntimeError):
    """浏览器交回的帧不满足契约。零成本段,失败可重试。"""


@dataclass(frozen=True)
class ClientBakeSpec:
    """浏览器出帧要的全部参数。字段名与出帧台钩子的入参一一对应。"""

    model_url: str
    clip: str
    direction: str
    camera_yaw: float
    frames: int
    width: int
    height: int
    material: str
    min_coverage: float

    def to_payload(self) -> dict[str, object]:
        return asdict(self)


def enabled() -> bool:
    """出帧是否交给浏览器。关掉即回到 worker 内 Playwright(过渡机仍需 render3d 镜像)。"""
    return os.getenv("WINDUP_RENDER3D_CLIENT_BAKE", "1").strip().lower() not in {
        "0", "false", "off", "no",
    }


def _key(task_id: int) -> str:
    return f"{KEY_PREFIX}{task_id}"


def _frames_key(task_id: int) -> str:
    return f"{KEY_PREFIX}{task_id}:frames"


def open_job(task_id: int, spec: ClientBakeSpec) -> float:
    """挂出一个待浏览器认领的出帧任务,返回过期时刻(epoch 秒)。"""
    deadline = time.time() + DEADLINE_S
    redis_client = get_redis()
    mapping = {k: str(v) for k, v in spec.to_payload().items()}
    mapping["deadline_at"] = str(deadline)
    pipe = redis_client.pipeline()
    pipe.delete(_frames_key(task_id))
    pipe.hset(_key(task_id), mapping=mapping)
    pipe.expire(_key(task_id), STATE_TTL_S)
    pipe.execute()
    schedule_delayed(
        delay_s=DEADLINE_S,
        stream=GENERATION_STREAM,
        msg_type=MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE,
        payload={"task_id": task_id, "reason": REASON_TIMEOUT},
        dedupe_key=f"generation:{task_id}:clientbake:timeout",
    )
    return deadline


def load_spec(task_id: int) -> tuple[ClientBakeSpec, float] | None:
    raw = get_redis().hgetall(_key(task_id))
    if not raw:
        return None
    spec = ClientBakeSpec(
        model_url=str(raw.get("model_url") or ""),
        clip=str(raw.get("clip") or ""),
        direction=str(raw.get("direction") or ""),
        camera_yaw=float(raw.get("camera_yaw") or 0.0),
        frames=int(raw.get("frames") or 0),
        width=int(raw.get("width") or 0),
        height=int(raw.get("height") or 0),
        material=str(raw.get("material") or ""),
        min_coverage=float(raw.get("min_coverage") or 0.0),
    )
    return spec, float(raw.get("deadline_at") or 0.0)


def put_frame(task_id: int, index: int, png: bytes) -> int:
    """收一帧,返回已收帧数。**只判形状,不判画得对不对** —— 后者在 worker 侧统一做。"""
    spec_and_deadline = load_spec(task_id)
    if spec_and_deadline is None:
        raise ClientBakeError(f"任务 {task_id} 没有待出帧的登记(可能已超时或已交付)")
    spec, _deadline = spec_and_deadline
    if not 0 <= index < spec.frames:
        raise ClientBakeError(f"帧下标 {index} 不在 0..{spec.frames - 1}")
    if len(png) > MAX_FRAME_BYTES:
        raise ClientBakeError(
            f"单帧 {len(png) / 1024:.0f}KB 超过上限 {MAX_FRAME_BYTES // 1024}KB"
        )
    if not png.startswith(b"\x89PNG\r\n\x1a\n"):
        # 形状守卫:空画布时 toDataURL 会给出没有 base64 段的串,切出来是空字符串。
        # 让它写进来的话,坏帧会一路当成正常产物走到交付。
        raise ClientBakeError(f"第 {index} 帧不是 PNG")
    redis_client = get_redis()
    pipe = redis_client.pipeline()
    pipe.hset(_frames_key(task_id), str(index), base64.b64encode(png).decode("ascii"))
    pipe.expire(_frames_key(task_id), STATE_TTL_S)
    pipe.hlen(_frames_key(task_id))
    return int(pipe.execute()[-1])


def collect_frames(task_id: int, expected: int) -> list[bytes]:
    """按下标取回全部帧。缺一帧就抛 —— 少给的后果是一段步子没走完的动作,不是崩溃。"""
    raw = get_redis().hgetall(_frames_key(task_id))
    frames: list[bytes] = []
    for i in range(expected):
        value = raw.get(str(i))
        if not value:
            raise ClientBakeError(f"缺第 {i} 帧(已收 {len(raw)}/{expected})")
        try:
            frames.append(base64.b64decode(value, validate=True))
        except (binascii.Error, ValueError) as exc:
            raise ClientBakeError(f"第 {i} 帧不是合法 base64") from exc
    return frames


def clear(task_id: int) -> None:
    get_redis().delete(_key(task_id), _frames_key(task_id))


def schedule_resume(task_id: int, reason: str = REASON_FRAMES, detail: str = "") -> None:
    """帧齐了(或浏览器自报失败)→ 交回 worker 续跑后处理。"""
    payload: dict[str, object] = {"task_id": task_id, "reason": reason}
    if detail:
        payload["detail"] = detail[:200]
    schedule_delayed(
        delay_s=0,
        stream=GENERATION_STREAM,
        msg_type=MSG_TYPE_CHARACTER_ACTION_CLIENT_BAKE,
        payload=payload,
        dedupe_key=f"generation:{task_id}:clientbake:{reason}",
    )


def public_view(task_id: int) -> dict[str, object] | None:
    """给前端的形状。``json.dumps`` 前先过一遍,免得 float 精度在两处各写一份。"""
    loaded = load_spec(task_id)
    if loaded is None:
        return None
    spec, deadline = loaded
    view = spec.to_payload()
    view["task_id"] = task_id
    view["deadline_at"] = deadline
    view["received"] = int(get_redis().hlen(_frames_key(task_id)))
    return json.loads(json.dumps(view))
