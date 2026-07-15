"""编排器：把各模块串成主干（首个可串联版本核心，Proposal §2.9①）。
接口为真、实现桩空、调用链写通、可空跑。"""
from __future__ import annotations
from .models import Project, CharacterCard, FrameSequence, LoopMode, GenRoute, GenerationRun
from .interfaces import (Generator, Matter, Aligner, LoopCloser,
                         Packager, EngineExporter, AssetStore)


class Pipeline:
    def __init__(self, gen: Generator, matter: Matter, aligner: Aligner,
                 loop: LoopCloser, packager: Packager,
                 exporter: EngineExporter, store: AssetStore) -> None:
        self.gen = gen
        self.matter = matter
        self.aligner = aligner
        self.loop = loop
        self.packager = packager
        self.exporter = exporter
        self.store = store

    def run(self, project: Project, card: CharacterCard,
            actions: list[str], out_dir: str) -> list[str]:
        seqs: list[FrameSequence] = []
        for action in actions:                      # idle / walk / attack
            seq = self.gen.generate(card, action, GenRoute.A_REFIMG)
            seq = self.matter.cutout(seq)           # 去背 + 去光晕
            seq = self.aligner.align(seq)           # 逐帧 pivot（内核）
            if seq.loop is not LoopMode.NONE:
                seq = self.loop.close(seq)          # idle/walk 闭合
            seqs.append(seq)
        pkg = self.packager.pack(seqs)
        files = self.exporter.export(pkg, out_dir)  # → Cocos 原生
        self.store.record(GenerationRun(
            action_name=",".join(actions), route=GenRoute.A_REFIMG,
            model="stub", prompt=card.appearance, seed=0, attempts=1,
            elapsed_s=0.0, cost_cny=0.0, license_note="stub",
            aigc_label="AI-generated"))
        return files
