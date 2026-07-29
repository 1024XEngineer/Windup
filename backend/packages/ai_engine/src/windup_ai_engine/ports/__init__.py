"""ai_engine 对外契约(ports)—— server 只 import 这里,不碰 graph / strategy / impl。

CI 的 import-linter 分层门禁会强制:app.server 依赖只到 ai_engine.ports。
换掉内部实现(strategy / provider)时 server 零改动。

本文件是接口契约(真),无实现。
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from windup_common.models import ActionSpec, AssetPackageRef, CharacterCard


# ---- server / framework 实现、注入给 ai_engine 的回调 port ----
class ProgressPort(Protocol):
    """进度上报 —— server 转 SSE / WS(取代管线里的 print(FLOWLOG))。"""

    def step(self, stage: str, i: int, total: int, note: str = "") -> None: ...


class ArtifactStorePort(Protocol):
    """二进制存储 —— 帧 / 图集 / 视频落对象存储返回 ref(ai_engine 不碰本地 FS)。"""

    def put(self, kind: str, data: bytes, meta: dict) -> str: ...

    def get(self, ref: str) -> bytes: ...


class Callbacks(Protocol):
    """注入包 —— ai_engine 运行时向外的所有出口,由 bootstrap 组装注入。"""

    progress: ProgressPort
    store: ArtifactStorePort


# ---- ai_engine 暴露给 server(server 调用的唯一入口)----
@runtime_checkable
class CharacterGeneratorPort(Protocol):
    """生成入口:角色卡 + 动作规格 → 引擎可用资产包。

    不关心租户 / 配额 / 任务状态(那些在 app.server)。
    """

    def generate(
        self, card: CharacterCard, action: ActionSpec, cb: Callbacks
    ) -> AssetPackageRef: ...
