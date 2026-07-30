"""CharacterGenerator —— 装配 strategy + 最后一公里,串起整条生产线(架构串联点)。

这是 CharacterGeneratorPort 的实现;server 经 port 调它、不碰这里。
串联:选路线(ROUTE_MATRIX)→ strategy.derive 出帧 → 最后一公里(脚线对齐)→
打包(sprite sheet)+ 存储 → 资产包。
对齐 / 打包已迁自 windup-pipeline 的 postprocess(脚线锚点对齐 + 拼图集);循环闭合
(tail_match)与多格式导出(#21 / #22)后续叠加。
"""
from __future__ import annotations

import io

from PIL import Image

from windup_common.models import (
    ActionSpec,
    AssetPackageRef,
    CharacterCard,
    GenRoute,
)

from windup_ai_engine.ports import Callbacks, CharacterGeneratorPort
from windup_ai_engine.postprocess import (
    align_bottom_center,
    frame_durations,
    sprite_sheet,
)
from windup_ai_engine.strategy.base import ROUTE_MATRIX, DerivationStrategy


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, "PNG")
    return buf.getvalue()


def _img(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGBA")


class CharacterGenerator(CharacterGeneratorPort):
    """由 bootstrap 注入 {GenRoute: DerivationStrategy} 装配表。"""

    def __init__(self, strategies: dict[GenRoute, DerivationStrategy]) -> None:
        self._by_route = strategies

    def generate(
        self, card: CharacterCard, action: ActionSpec, cb: Callbacks
    ) -> AssetPackageRef:
        # ① 选路线(架构决策矩阵)
        route = ROUTE_MATRIX[action.action]
        cb.progress.step("route", 0, 3, f"{action.action} → {route.value}")
        strategy = self._by_route[route]

        # ② 生成帧(交给 strategy —— 串联)
        frames = strategy.derive(card, action, cb)

        # ③ 最后一公里 + 打包(护城河,串联)
        frames = self._lastmile(frames, action, cb)
        return self._package(card, action, frames, cb)

    def _lastmile(
        self, frames: list[bytes], action: ActionSpec, cb: Callbacks
    ) -> list[bytes]:
        """脚线对齐:把各帧对齐成原地序列帧(消除逐帧画布漂移,Issue #21)。

        位移轨道(root_motion)MVP 先不做(见 #63 / character_data.frames 暂无该字段):
        序列帧保持原地即可,位移留给后续 export / playtest 阶段再算。
        """
        cb.progress.step("lastmile", 1, 3, "脚线对齐(原地)")
        if not frames or not all(frames):   # 含空桩帧(未开发路线)→ 跳过
            return frames
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

    def _package(
        self,
        card: CharacterCard,
        action: ActionSpec,
        frames: list[bytes],
        cb: Callbacks,
    ) -> AssetPackageRef:
        cb.progress.step("package", 2, 3, "sprite sheet + 存储")
        sheet_ref = ""
        valid = [f for f in frames if f]
        if valid:
            sheet_png = _png(sprite_sheet([_img(f) for f in valid]))
            sheet_ref = cb.store.put("sheet", sheet_png, {"action": action.action.value})
        # TODO(dev, #22): 写 Cocos plist(SpriteFrames)→ plist_ref
        return AssetPackageRef(
            character=card.name,
            action=action.action,
            fps=action.fps,
            sheet_ref=sheet_ref,
            frame_refs=[cb.store.put("frame", f, {"i": i}) for i, f in enumerate(frames)],
            root_motion=[],   # MVP 不做(⑥),留空
            durations=frame_durations(action.action.value, len(frames)),
        )
