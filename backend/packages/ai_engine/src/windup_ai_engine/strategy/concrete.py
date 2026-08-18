"""三条 DerivationStrategy。

- VideoFrameStrategy：**已迁入 windup-pipeline 实测通路**（walk 主链，2026-07-27 验证）。
- PerFrameStrategy：**未实现**，调用即抛 NotImplementedError（见 #53）。不返回空帧——
  空帧会伪装成一次成功的生成流到 server 落库，用户看到的是一组裂图。
- RenderFrameStrategy：三渲二。吃**已绑骨的 3D 模型**（不是母版图），纯本地渲帧、
  零 API 成本；建模型那两段按次计费的活在 server 侧（#121 #122）。

VideoFrameStrategy 实测通路：严格侧面母版 → kling i2v(v2-5-turbo) → 抽单循环 N 帧 →
matte 抠图 → 像素化。返回对齐前的 RGBA PNG 帧（对齐 / 打包在 CharacterGenerator 最后一公里）。
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from windup_common.models import (
    ActionSpec,
    ActionType,
    CharacterCard,
    Facing,
    GenRoute,
    Stylize,
)
from windup_framework.providers import ImageProvider, MatteProvider, VideoProvider

from windup_ai_engine._imgio import from_png as _img
from windup_ai_engine._imgio import to_png as _png
from windup_ai_engine.master_prep import prepare_master
from windup_ai_engine.ports import ProgressPort
from windup_ai_engine.postprocess import master_pixel_spec, pixelate_frames
from windup_ai_engine.slicing import extract_all_frames_bytes, pick_cycle, pick_oneshot
from windup_ai_engine.prompt import (
    build_attack_prompt,
    build_custom_prompt,
    build_idle_prompt,
    build_jump_prompt,
    build_walk_prompt,
)
from windup_ai_engine.strategy.base import DerivationStrategy, is_cyclic

if TYPE_CHECKING:
    from windup_framework.providers.render3d import SpriteRenderProvider, SpriteSheet


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
        # custom 单独一支:它的动作内容来自用户,只能由 build_custom_prompt 把那句话
        # 嵌进机制骨架(朝向锁 / 正向措辞 / 装备存在无关 / 一次性的单次+终态保持)。
        # 不能塞进下面那张表 —— 那张表里的 builder 只接 facing。
        if action.action is ActionType.CUSTOM:
            return build_custom_prompt(
                action.custom_action or "",
                facing=action.facing,
                cyclic=bool(action.cyclic),
            )
        # attack 同样进不了那张表:它还要按运动拓扑选提示词分支。archetype 缺省时不在这里
        # 兜一个默认值 —— 缺省只由 build_attack_prompt 定义一次,写两处会各自漂移。
        if action.action is ActionType.ATTACK:
            if action.archetype is None:
                return build_attack_prompt(facing=action.facing)
            return build_attack_prompt(facing=action.facing, archetype=action.archetype)
        builders = {
            ActionType.JUMP: build_jump_prompt,
            ActionType.IDLE: build_idle_prompt,
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
        # 帧数直接读契约字段:缺省值已收进 ActionSpec(DEFAULT_N_FRAMES),不再由本层
        # 用 `or 8` 兜底 —— 那等于把契约的缺省值写在实现里,换条 strategy 就换个默认值。
        n = action.n_frames
        # 进度文案里的枚举一律取 .value:Python 3.11+ 改了 str-mixin 枚举的 __format__,
        # f"{action.action}" 现在给的是 "ActionType.WALK" 而不是 "walk"(3.12.13 实测),
        # 而这串字会经 server 变成用户看到的 SSE 进度。
        progress.step("derive", 0, 3, f"{action.action.value}: i2v 生成视频")
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
        if is_cyclic(action):
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
        if action.stylize is Stylize.NONE:
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
    """离散姿势（hit 等，需单帧可编辑）：逐帧图生图 → 抠图。**未实现**（#53）。

    这条路线的价值在"单帧可重画"，与 i2v 是不同的产品能力，不能拿 i2v 顶替。
    """

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
        # 显式抛错，**不返回空帧**。曾经的桩实现 `return [b""] * n_frames` 会让调用方拿到
        # 一个"帧数对、时长对、无异常"的 GeneratedAction —— server 照常把 N 个 0 字节文件
        # 传上对象存储、写进 character_data，用户看到 N 张裂图，且排查时不会想到是路线没实现。
        # 未实现就要在边界上炸，不能让空数据流下去。
        raise NotImplementedError(
            f"生成路线 {self.route.value} 尚未实现（动作 {action.action.value}）。"
            "见 1024XEngineer/Windup#53。"
        )


# Facing → 出帧台的朝向名。键名与前端导出模型的 ExportAction.sequences[].direction
# 同域,不需要转换层。
#
# **值是真渲一遍量出来的,不能按方位名推。** 直觉上 "south = 朝观者",实际 n(yaw=90°)
# 才是正面(奶白胸腹与口鼻可见,浅色像素占比 21.0%),s 是背面(8.5%)。两者主体像素数
# 几乎相同,靠轮廓分不出正反,而单元测试也逮不到 —— 朝向错了但帧数、时长、成色全部正常。
# 改这张表之前先渲一遍再量。
_FACING_TO_DIRECTION: dict[Facing, str] = {
    Facing.SIDE: "e",     # yaw=0°,角色朝画面右(与出帧台 faces="right" 同口径)
    Facing.FRONT: "n",    # yaw=90°,身体正对观者
}


class RenderFrameStrategy(DerivationStrategy):
    """三渲二:已绑骨的 3D 模型 → 套预设动作 → 渲 2D 序列帧。

    **吃的是绑骨模型,不是母版图。** 图生 3D 与自动绑骨那两段按次计费、每造型一次性,
    由 server 侧的 ``Render3DAssetBuilder`` 负责(#121);走到这里钱已经花完,本段纯本地、
    零 API 成本。相对 i2v 的独占优势是**多朝向零成本且跨朝向天生一致**。
    """

    route = GenRoute.RENDER_3D

    def __init__(
        self,
        renderer: SpriteRenderProvider,
        *,
        directions: int = 4,
        material: str = "cel",
        size: tuple[int, int] | None = None,
    ) -> None:
        # 出帧台的 provider 包只在这条路线上用得着(它连着 node + 浏览器)。在模块顶层
        # import 会让走 i2v / 逐帧的部署也必须装齐它,而这两条路线一行都用不到。
        from windup_framework.providers.render3d import RENDER_SIZE

        self._renderer = renderer
        self._directions = directions
        self._material = material
        self._size = size or RENDER_SIZE

    def derive(
        self,
        card: CharacterCard,
        action: ActionSpec,
        rigged_model: bytes,
        progress: ProgressPort,
    ) -> list[bytes]:
        if not rigged_model:
            # 空模型必须在这里炸:让它流下去的话出帧台只报一句"Bad glTF",
            # 排查方向会整个跑偏到出帧管线上。
            raise ValueError(
                f"三渲二拿到空的绑骨模型(角色 {card.name!r}、动作 {action.action.value})。"
                "server 侧应在调用前确认该造型的 3D 资产可读。"
            )

        want = _FACING_TO_DIRECTION.get(action.facing, "e")
        progress.step(
            "derive", 0, 3,
            f"渲 {self._directions} 朝向 × {action.n_frames} 帧"
            f"({self._size[0]}×{self._size[1]},材质 {self._material})",
        )
        sheet: SpriteSheet = self._renderer.render(
            rigged_model,
            clip=action.action.value,
            directions=self._directions,
            frames=action.n_frames,
            size=self._size,
            material=self._material,
        )

        available = tuple(s.direction for s in sheet.sequences)
        chosen = next((s for s in sheet.sequences if s.direction == want), None)
        if chosen is None:
            # 不静默换一个朝向交出去:朝向错了的序列帧就是角色朝反方向走,
            # 而帧数、时长、成色全都正常,没有任何一道会红。
            raise ValueError(
                f"出帧台没有产出朝向 {want}(动作 {action.action.value}、facing "
                f"{action.facing.value});实际产出 {available}。"
            )
        frames = list(chosen.frames)
        if not frames:
            raise ValueError(
                f"三渲二未产出任何帧(动作 {action.action.value}、朝向 {chosen.direction})。"
            )

        extra = [d for d in available if d != chosen.direction]
        if extra:
            # 如实报:这些朝向已经渲出来了、零额外成本,但出参装不下,只能丢。
            # 不写成 warning 日志而是进度文案,因为这串字最终会经 server 到用户眼前,
            # 而"多朝向"正是这条路线的卖点 —— 用户该知道它已经算好了。
            progress.step(
                "derive", 1, 3,
                f"已渲 {len(available)} 个朝向,本次出参只带 {chosen.direction};"
                f"其余 {','.join(extra)} 零成本可用但当前契约装不下(#122)",
            )
        else:
            progress.step("derive", 1, 3, f"朝向 {chosen.direction} 共 {len(frames)} 帧")

        # 3D 帧本来就是透明底,**不套抠图**:去白边那一步会把浅灰甲当漏白吃掉。
        # 像素化仍按 ActionSpec 走。
        if action.stylize is Stylize.NONE:
            progress.step("derive", 2, 3, "保留渲染画风(不像素化)")
            return frames

        # 像素化的目标高与色板本来该从母版量(master_pixel_spec),但本路线**没有母版** ——
        # 它吃的是 3D 模型。所以只能按 ActionSpec 声明的 pixel_h + 通用量化走。
        # 这是一处已知差异,不是遗漏:锁母版色板要靠母版像素,而这条路线上根本没有那张图。
        progress.step("derive", 2, 3, f"像素化(h={action.pixel_h}·通用量化)")
        pix = pixelate_frames(
            [_img(f) for f in frames],
            target_h=action.pixel_h,
            palette_size=action.palette_size,
        )
        return [_png(p) for p in pix]


# 注:曾有 ProcIdleStrategy(GenRoute.PROC_IDLE)—— 待机走"母版抠图 + 程序化局部躯干呼吸"
# 的零 API 路线(Idle-B,#53 原设计)。**2026-08-07 定案放弃**:程序化呼吸做不出可用效果,
# idle 统一走 i2v、认这份钱。GenRoute.PROC_IDLE 一并移除,不留没有实现的枚举值。
