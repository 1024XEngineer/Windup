"""模块对外接口契约（接口为真；实现由各模块桩空）。"""
from __future__ import annotations
from typing import Protocol
from .models import (CharacterCard, FrameSequence, DeliveryPackage,
                     GenerationRun, GenRoute)


class Generator(Protocol):
    """生成端：统一契约，路线 A/B 各实现一个 adapter。"""
    def generate(self, card: CharacterCard, action_name: str,
                 route: GenRoute) -> FrameSequence: ...


class Matter(Protocol):
    def cutout(self, seq: FrameSequence) -> FrameSequence: ...          # 去背 + 去光晕


class Aligner(Protocol):
    def align(self, seq: FrameSequence) -> FrameSequence: ...           # 逐帧 bbox/pivot


class LoopCloser(Protocol):
    def close(self, seq: FrameSequence) -> FrameSequence: ...           # 首尾无缝


class Packager(Protocol):
    def pack(self, seqs: list[FrameSequence]) -> DeliveryPackage: ...


class EngineExporter(Protocol):
    target: str                                                        # "cocos" / "godot"
    def export(self, pkg: DeliveryPackage, out_dir: str) -> list[str]: ...


class AssetStore(Protocol):
    def record(self, run: GenerationRun) -> None: ...
    def save_card(self, card: CharacterCard) -> str: ...
