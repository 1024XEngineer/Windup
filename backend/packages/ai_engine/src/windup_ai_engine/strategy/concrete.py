"""三条 DerivationStrategy。

- VideoFrameStrategy：**已迁入 windup-pipeline 实测通路**（walk 主链，2026-07-27 验证）。
- PerFrameStrategy / ProcIdleStrategy：桩，待开发（见 #53，per-frame / idle 非首个竖线）。

VideoFrameStrategy 实测通路：严格侧面母版 → kling i2v(v2-5-turbo) → 抽单循环 N 帧 →
matte 抠图 → 像素化。返回对齐前的 RGBA PNG 帧（对齐 / 打包在 CharacterGenerator 最后一公里）。
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

from windup_common.models import ActionSpec, ActionType, CharacterCard, GenRoute
from windup_framework.providers import ImageProvider, MatteProvider, VideoProvider

from windup_ai_engine.master_prep import prepare_master
from windup_ai_engine.ports import ProgressPort
from windup_ai_engine.postprocess import master_pixel_spec, pixelate_frames
from windup_ai_engine.slicing import extract_all_frames_bytes, pick_cycle, pick_oneshot
from windup_ai_engine.prompt import (
    build_attack_prompt,
    build_idle_prompt,
    build_jump_prompt,
    build_walk_prompt,
)
from windup_ai_engine.strategy.base import DerivationStrategy


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, "PNG")
    return buf.getvalue()


def _img(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGBA")


# 循环类动作走"步态周期抽单周期闭环";一次性动作**不能闭环**(首尾姿态不同,强行闭环
# 会把落地帧接回蓄力帧=抽搐),改走"裁动作区间 + 区间内均匀取"。
CYCLIC_ACTIONS = frozenset({ActionType.IDLE, ActionType.WALK, ActionType.RUN})


class VideoFrameStrategy(DerivationStrategy):
    """视频路线：母版 → i2v → 抽帧 → 抠图 → 像素化。

    覆盖循环类(walk/run)与一次性类(jump/attack)——按 :data:`CYCLIC_ACTIONS` 分流抽帧方式。
    硬前提：**提示词朝向必须与母版一致**(side/front)；给正面母版喂侧走词会让模型靠转身
    调和图文矛盾(实测 #35)。
    """

    route = GenRoute.VIDEO_I2V

    def __init__(self, video: VideoProvider, matte: MatteProvider) -> None:
        self._video = video
        self._matte = matte

    def _build_prompt(self, action: ActionSpec) -> str:
        """按动作类型选提示词;朝向随 ActionSpec.facing。"""
        builders = {
            ActionType.JUMP: build_jump_prompt,
            ActionType.IDLE: build_idle_prompt,
            ActionType.ATTACK: build_attack_prompt,
        }
        build = builders.get(action.action, build_walk_prompt)
        return build(facing=action.facing)

    def derive(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
    ) -> list[bytes]:
        n = action.n_frames or 8
        progress.step("derive", 0, 3, f"{action.action}: i2v 生成视频")
        # 母版按动作预处理:jump 要在顶部补空间,否则角色腾空时头顶顶出视频画面被裁
        framed = prepare_master(master, action.action.value)
        video = self._video.i2v(framed, self._build_prompt(action), seconds=5)

        dense = extract_all_frames_bytes(video)
        # 跨动作一致性:用视频首帧(=母版姿态)的角色高当共同定标基准。各动作都从同一母版
        # 起手,故此值一致 —— 否则各动作按自己最高帧定标,切状态时角色会忽大忽小。
        ref_h = None
        if dense:
            _first = _img(self._matte.cutout(_png(dense[0])))
            _ys, _ = np.where(np.asarray(_first)[:, :, 3] > 128)
            ref_h = float(_ys.max() - _ys.min()) if len(_ys) else None
        if action.action in CYCLIC_ACTIONS:
            progress.step("derive", 1, 3, f"步态周期取 {n} 帧(无缝 loop)+ 抠图")
            picked = pick_cycle(dense, n)                   # 单周期闭环(#21)
        else:
            progress.step("derive", 1, 3, f"裁动作区间取 {n} 帧(不闭环)+ 抠图")
            kind = "airborne" if action.action is ActionType.JUMP else "swing"
            picked = pick_oneshot(dense, n, kind=kind)      # 一次性动作:裁起止
        cut = [_img(self._matte.cutout(_png(im))) for im in picked]

        # 风格化按需(见 ActionSpec.stylize):none=保留 i2v 画风(插画/伪 3D 角色);
        # pixel=像素化。原生像素角色**按母版规格**做:吸附母版像素网格 + 锁母版色板,
        # 顺带消掉首帧 JPG / H.264 在硬边留下的灰颗粒(实测:通用降采样+量化反而更糊)。
        if action.stylize == "none":
            progress.step("derive", 2, 3, "保留 i2v 画风(不像素化)")
            return [_png(im) for im in cut]

        target_h, palette = action.pixel_h, None
        try:
            logical_h, pal = master_pixel_spec(_img(master))   # 用原始母版,不用补过边的
            if logical_h > 8:                      # 母版确为像素画 → 按它的规格走
                target_h, palette = logical_h, pal
        except Exception:                          # 母版非像素画/量不出 → 回退通用量化
            pass
        progress.step(
            "derive", 2, 3,
            f"像素化(h={target_h}{'·锁母版色板' if palette is not None else '·通用量化'})",
        )
        pix = pixelate_frames(
            cut, target_h=target_h, palette_size=action.palette_size,
            palette=palette, ref_height=ref_h,
        )
        return [_png(p) for p in pix]


class PerFrameStrategy(DerivationStrategy):
    """离散姿势（hit 等，需单帧可编辑）：逐帧图生图 → 抠图。桩，待开发（#53）。"""

    route = GenRoute.PER_FRAME

    def __init__(self, image: ImageProvider, matte: MatteProvider) -> None:
        self._image = image
        self._matte = matte

    def derive(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
    ) -> list[bytes]:
        progress.step("derive", 0, 1, f"{action.action}: 逐帧图生图")
        # TODO(dev, #53): 逐 pose image.gen_image(母版, pose) → matte.cutout（不加骨架）
        return [b"" for _ in range(action.n_frames)]  # 桩


class ProcIdleStrategy(DerivationStrategy):
    """待机（idle）：母版抠图 → 程序化局部躯干呼吸（Idle-B，零 API）。桩，待开发（#53）。"""

    route = GenRoute.PROC_IDLE

    def __init__(self, image: ImageProvider, matte: MatteProvider) -> None:
        self._image = image
        self._matte = matte

    def derive(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
    ) -> list[bytes]:
        progress.step("derive", 0, 1, f"{action.action}: Idle-B 程序化呼吸")
        # TODO(dev, #53): 母版抠图 → 躯干带保体积缩放，腿冻结
        return [b"" for _ in range(action.n_frames)]  # 桩
