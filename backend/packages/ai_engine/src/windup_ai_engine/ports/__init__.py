"""ai_engine 对外契约(ports)—— server 只 import 这里,不碰 slicing / strategy / impl。

CI 的 import-linter 分层门禁会强制:app.server 依赖只到 ai_engine.ports。
换掉内部实现(strategy / provider)时 server 零改动。

MVP 边界(与作者对齐):ai_engine **只产出帧 bytes + 进度**,不碰存储 / DB。
母版(master)由 server 侧从 ``Character.reference_image_url`` 取好、以 bytes 传入;
产出的帧由 server 侧上传对象存储、落 ``character_data``。故本层无 ArtifactStore 依赖。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from windup_common.models import ActionSpec, CharacterCard


# ---- server 实现、注入给 ai_engine 的进度回调 port ----
class ProgressPort(Protocol):
    """进度上报 —— server 转 SSE / 轮询状态(取代管线里的 print)。"""

    def step(self, stage: str, i: int, total: int, note: str = "") -> None: ...


# ---- ai_engine 出参(不含存储引用:上传 / 落库在 server 侧)----
@dataclass
class GeneratedAction:
    """一个动作的生成产物:对齐后的原地序列帧 + 逐帧时长。

    frames / durations **等长**;server 侧把每帧上传对象存储得 URL,组成
    ``CharacterActionOutput.frames[{index, image_url, duration_ms}]`` 回填 character_data。
    """

    frames: list[bytes] = field(default_factory=list)   # RGBA PNG,按播放序
    durations: list[int] = field(default_factory=list)  # 逐帧时长(ms),与 frames 等长
    fps: int = 10


# ---- ai_engine 暴露给 server(server 调用的唯一入口)----
@runtime_checkable
class CharacterGeneratorPort(Protocol):
    """生成入口:角色卡 + 动作规格 + 母版 → 帧序列产物。

    不关心租户 / 配额 / 任务状态 / 存储(那些在 app.server)。

    Args:
        card: 角色卡(身份 / 画风 / 朝向)。
        action: 动作规格(类型 / 帧数 / 风格化 / 朝向)。
        master: 定妆母版图 bytes(server 从 reference_image_url 取)。
        progress: 进度回调。
    """

    def generate(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
    ) -> GeneratedAction: ...
