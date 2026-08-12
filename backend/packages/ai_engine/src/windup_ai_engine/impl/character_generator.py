"""CharacterGenerator —— 装配 strategy + 最后一公里,串起整条生产线(架构串联点)。

这是 CharacterGeneratorPort 的实现;server 经 port 调它、不碰这里。
串联:母版预检(可拒绝)→ 选路线(ROUTE_MATRIX)→ strategy.derive 出帧 →
最后一公里(脚线对齐)→ 量交付成色 → GeneratedAction。

两头各有一道闸,方向相反:进门那道(master_check)在**花钱之前**挡住不可能生成好的
输入;出门那几道(空帧 / 帧数 / 成色)在钱已经花完之后,挡住"看起来成功的错产物"。

MVP 边界(与作者对齐):**只出帧 bytes + 逐帧时长**,不打包 sprite sheet、不落存储——
上传对象存储、写 character_data、拼图集/多格式导出由 server / export 侧做(#22)。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from windup_common.models import ActionSpec, CharacterCard, GenRoute

from windup_ai_engine._imgio import from_png as _img
from windup_ai_engine._imgio import to_png as _png
from windup_ai_engine.master_check import check_master
from windup_ai_engine.ports import (
    ActionQuality,
    CharacterGeneratorPort,
    GeneratedAction,
    ProgressPort,
)
from windup_ai_engine.postprocess import align_bottom_center, frame_durations
from windup_ai_engine.slicing import dead_frame_indices, loop_seam, motion_scale
from windup_ai_engine.strategy.base import (
    CYCLIC_ACTIONS,
    ROUTE_MATRIX,
    DerivationStrategy,
)




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
        canvas: tuple[int, int] | None = None,
    ) -> GeneratedAction:
        # ① 入口预检 —— 唯一一道在**花钱之前**的闸,故排在选路线之前。
        # 之前这里什么都不判:一张"人物在画板前作画"的图请求 walk,全程无一处报错,
        # 16 帧构图完整的错角色出完、钱花完(2026-08-07 实测)。预检拦不住"内容画错"
        # (那要视觉模型),但坏图 / 空图 / 极端比例这几类不必等到出帧才发现。
        # 预检与出帧必须用**同一个** canvas:比例上限是由交付画布几何推出来的,
        # 传一个、出另一个就等于预检按方形判、出帧按非方出(见 master_check)。
        facts = check_master(master, canvas)
        progress.step("precheck", 0, 4, facts.note())

        # ② 选路线(架构决策矩阵)。装配表里没有 = 该路线未实现,在边界上炸,
        # 不要让"看着成功、内容是空"的结果流到 server 去落库。
        route = ROUTE_MATRIX[action.action]
        # .value 而不是枚举本身:Python 3.11+ 的 str-mixin 枚举 __format__ 会给出
        # "ActionType.WALK",这串字最终是用户看到的进度文案(3.12.13 实测)。
        progress.step("route", 1, 4, f"{action.action.value} → {route.value}")
        strategy = self._by_route.get(route)
        if strategy is None:
            raise NotImplementedError(
                f"动作 {action.action.value} 分流到 {route.value}，但未注入该路线的 strategy。"
                f"已装配：{sorted(r.value for r in self._by_route)}。"
            )

        # ③ 生成帧(交给 strategy —— 串联)
        frames = strategy.derive(card, action, master, progress)

        # ③.5 帧数必须与契约相符。A2 把 n_frames 从 len(poses) 的推导值改成调用方直接声明的
        # 承诺,而抽帧那两个函数都会**静默少给**:slicing.pick_cycle / pick_oneshot 在
        # `len(dense) <= n`(或动作区间比 n 短)时 return frames/span,长度不足且不报错
        # (2026-08-08 读码复核)。少给的后果不是崩溃而是"短一截的动作":时长表由
        # frame_durations(…, len(frames)) 现算,长度自洽,server 看不出异常,用户拿到
        # 一段步子没走完的循环。故在此对账 —— 钱已经花了,但至少不让错产物流下去。
        # 放在 generator 而不是某个 strategy 里:这样将来任何新路线都受同一条约束。
        if len(frames) != action.n_frames:
            raise ValueError(
                f"{route.value} 要 {action.n_frames} 帧,实际产出 {len(frames)} 帧。"
                "抽帧源帧数不足(i2v 视频太短 / 动作区间过窄)时会静默少给,"
                "请调小 n_frames 或加长视频。"
            )

        # ④ 最后一公里:脚线对齐成原地序列帧(直接对齐到调用方要的画布尺寸)
        aligned = self._lastmile(frames, progress, canvas)

        # ⑤ 量交付成色。在**对齐之后**量,量的是用户真正会看到的那组帧:抠图 / 像素化 /
        # 对齐都会改像素,在中间任何一步量出来的数都描述不了交付物。
        quality = self._assess(aligned, action)

        # ⑥ 出参:帧 + 逐帧时长 + 成色(上传 / 落库在 server 侧)
        progress.step(
            "package", 3, 4,
            f"{len(aligned)} 帧 + 逐帧时长(动量 {quality.motion_scale:.2f},"
            f"死帧 {len(quality.dead_frames)}/{len(aligned)})",
        )
        return GeneratedAction(
            frames=[_png(im) for im in aligned],
            durations=frame_durations(action.action.value, len(aligned)),
            quality=quality,
        )

    def _assess(self, frames: list[Image.Image], action: ActionSpec) -> ActionQuality:
        """量交付帧的成色。这些数只上报、**不改动产物**,也不在此处代替调用方做判决。

        为什么不在这里直接对着阈值抛错:交付 / 重试 / 让用户换母版是产品决策,阈值该由
        server 按场景定;而且到这一步钱已经花完,引擎单方面丢弃产物只是把损失变成两份。
        引擎负责"如实报数",不负责"替上层决定这次算不算数"。

        ``loop_seam`` 只对循环类动作量:一次性动作(jump/attack)首尾姿态本就不同,
        给它算一个"接缝"再交出去,等于发一个必然难看的数让上层照着做错误决定。
        """
        return ActionQuality(
            motion_scale=motion_scale(frames),
            dead_frames=dead_frame_indices(frames),
            loop_seam=loop_seam(frames) if action.action in CYCLIC_ACTIONS else None,
        )

    def _lastmile(
        self,
        frames: list[bytes],
        progress: ProgressPort,
        canvas: tuple[int, int] | None = None,
    ) -> list[Image.Image]:
        """脚线对齐:把各帧对齐成原地序列帧(消除逐帧画布漂移,Issue #21)。

        返回 PIL 而不是 PNG bytes:紧接着的成色测量要按图看帧,再编码回 PNG 只为了
        让上一句话好听、下一句话又得解码回来。编码统一在 ``generate`` 出参那一步做。

        位移轨道(root_motion)MVP 先不做(见 #63 / character_data.frames 暂无该字段):
        序列帧保持原地即可,位移留给后续 export / playtest 阶段再算。

        ``canvas`` 给定时直接对齐到该尺寸,而不是恒出 256 再让上层缩。上层那次缩放
        (``Image.thumbnail`` 补边)**只缩不放**:项目要 512 时 256 的帧不会被放大,而是
        原尺寸居中贴进 512 画布,于是这里刚对齐好的脚线 0.92 被挪到 0.709(2026-08-11
        实测),角色不站在地上、跨动作对齐也失效。在这里一次出到位就没有那一步了。
        """
        progress.step("lastmile", 2, 4, "脚线对齐(原地)")
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
        hs = []
        for im in imgs:
            ys, _ = np.where(np.asarray(im)[:, :, 3] > 128)
            if len(ys):
                hs.append(float(ys.max() - ys.min()))
        # TODO(dev, #21): tail_match 循环闭合(净位移动作先锚点再匹配帧)
        ref = float(np.median(hs)) if hs else None
        if canvas is None:
            return align_bottom_center(imgs, ref_height=ref)
        cw, ch = canvas
        return align_bottom_center(imgs, cell=cw, cell_h=ch, ref_height=ref)
