"""CharacterGenerator —— 装配 strategy + 最后一公里,串起整条生产线(架构串联点)。

这是 CharacterGeneratorPort 的实现;server 经 port 调它、不碰这里。
串联:选路线(ROUTE_MATRIX)→ strategy.derive 出帧 → 最后一公里(脚线对齐)→ GeneratedAction。

MVP 边界(与作者对齐):**只出帧 bytes + 逐帧时长**,不打包 sprite sheet、不落存储——
上传对象存储、写 character_data、拼图集/多格式导出由 server / export 侧做(#22)。
"""
from __future__ import annotations



from windup_common.models import ActionSpec, CharacterCard, GenRoute

from windup_ai_engine._imgio import from_png as _img
from windup_ai_engine._imgio import to_png as _png
from windup_ai_engine.ports import (
    CharacterGeneratorPort,
    GeneratedAction,
    ProgressPort,
)
from windup_ai_engine.postprocess import align_bottom_center, frame_durations
from windup_ai_engine.strategy.base import ROUTE_MATRIX, DerivationStrategy




class CharacterGenerator(CharacterGeneratorPort):
    """由 bootstrap 注入 {GenRoute: DerivationStrategy} 装配表。"""

    def __init__(self, strategies: dict[GenRoute, DerivationStrategy]) -> None:
        self._by_route = strategies

    def generate(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
    ) -> GeneratedAction:
        # ① 选路线(架构决策矩阵)。装配表里没有 = 该路线未实现,在边界上炸,
        # 不要让"看着成功、内容是空"的结果流到 server 去落库。
        route = ROUTE_MATRIX[action.action]
        progress.step("route", 0, 3, f"{action.action} → {route.value}")
        strategy = self._by_route.get(route)
        if strategy is None:
            raise NotImplementedError(
                f"动作 {action.action.value} 分流到 {route.value}，但未注入该路线的 strategy。"
                f"已装配：{sorted(r.value for r in self._by_route)}。"
            )

        # ② 生成帧(交给 strategy —— 串联)
        frames = strategy.derive(card, action, master, progress)

        # ③ 最后一公里:脚线对齐成原地序列帧
        frames = self._lastmile(frames, progress)

        # ④ 出参:帧 + 逐帧时长(上传 / 落库在 server 侧)
        progress.step("package", 2, 3, f"{len(frames)} 帧 + 逐帧时长")
        return GeneratedAction(
            frames=frames,
            durations=frame_durations(action.action.value, len(frames)),
            fps=action.fps,
        )

    def _lastmile(self, frames: list[bytes], progress: ProgressPort) -> list[bytes]:
        """脚线对齐:把各帧对齐成原地序列帧(消除逐帧画布漂移,Issue #21)。

        位移轨道(root_motion)MVP 先不做(见 #63 / character_data.frames 暂无该字段):
        序列帧保持原地即可,位移留给后续 export / playtest 阶段再算。
        """
        progress.step("lastmile", 1, 3, "脚线对齐(原地)")
        # 空帧不再静默跳过:未实现的路线现在在 strategy / 装配表处就抛错(见 generate),
        # 走到这里还有空帧说明 provider 或抠图吐了坏数据,同样要炸而不是原样放行。
        if not frames:
            raise ValueError("strategy 未产出任何帧")
        bad = [i for i, f in enumerate(frames) if not f]
        if bad:
            raise ValueError(f"strategy 产出了 {len(bad)}/{len(frames)} 个空帧，索引 {bad[:8]}")
        imgs = [_img(f) for f in frames]
        # 参考姿态高 = 各帧包围盒高的中位数:比"最高帧"稳(不被举过头顶的武器带偏),
        # 各动作都以自身中位姿态定标,本体尺寸跨动作一致。
        import numpy as _np
        _hs = []
        for _im in imgs:
            _ys, _ = _np.where(_np.asarray(_im)[:, :, 3] > 128)
            if len(_ys):
                _hs.append(float(_ys.max() - _ys.min()))
        aligned = align_bottom_center(imgs, ref_height=(float(_np.median(_hs)) if _hs else None))
        # TODO(dev, #21): tail_match 循环闭合(净位移动作先锚点再匹配帧)
        return [_png(im) for im in aligned]
