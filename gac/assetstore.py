"""角色卡 / 生成记录 / 版本 持久化与续生成。MS1 桩：内存实现；MS2 换持久层。"""
from __future__ import annotations
from .models import GenerationRun, CharacterCard


class InMemoryAssetStore:
    def __init__(self) -> None:
        self.runs: list[GenerationRun] = []
        self.cards: dict[str, CharacterCard] = {}

    def record(self, run: GenerationRun) -> None:
        self.runs.append(run)

    def save_card(self, card: CharacterCard) -> str:
        cid = f"card-{len(self.cards) + 1}"
        self.cards[cid] = card
        return cid
