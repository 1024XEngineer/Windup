"""母版可生成性预检 —— 入口处**允许拒绝**的那道闸,在花钱之前。

为什么有这个模块:ai_engine 此前所有 ``raise`` 都在输出侧,``generate(card, action,
master, progress)`` 对 ``master`` 一个前置判定都没有。2026-08-07 实测:喂一张"人物在
画板前作画"的图请求 walk,全程无一处报错,最终产出 16 帧构图完整的序列帧,画面是个
不会走路的错角色 —— 钱已花完才发现。

**本层判什么(三条,全部本地零成本、可复现):**
  ① 能否解码 —— 坏 bytes / 截断文件不必等 i2v 跑完再发现;
  ② 有没有可动的主体 —— 全透明 / 全同色 = 画面里没有东西可动;
  ③ 主体宽高比下游装不装得下 —— 见 :data:`REJECT_ASPECT`。

**本层不判什么、为什么 —— 别把下面这些当成已经守住了:**
  - **画的是不是一个角色、是不是该动作要的姿态**(walk 要侧向、attack 要蓄力,见
    :data:`master_prep.MASTER_POSES`)。需要视觉模型读画面语义,本层只有 numpy。
    **开头那张"人物在画板前作画"的图,本预检拦不住**:它能解码、有主体、比例正常。
    本层挡的是它的近邻(空图 / 坏图 / 极端比例),挡不住"内容画错"。要真正堵住这个,
    得在预检里接一次廉价的视觉判定(便宜的 VLM 问一句"这是不是一个可行走的角色、
    朝向是不是侧面"),那是另一件事、要另外的实测与预算。
  - **朝向与 ``ActionSpec.facing`` 是否一致** —— 同上,需要视觉模型。
  - **背景干不干净到能抠图** —— 抠图是 ``MatteProvider``(rembg/u2net)的事;本层的
    四角中位色启发式判不出"这块背景 rembg 能不能抠掉"。
  - **分辨率下限** —— 故意不判。i2v 供应商对首帧分辨率的真实下限我没有实测数据,
    拍一个阈值就是拿没验证的判据挡掉用户的钱。:data:`MIN_SUBJECT_SIDE` 只挡退化端
    (小到与噪点无从区分),不是画质阈值。

纯 PIL / numpy,零 API,不联网。
"""
from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, UnidentifiedImageError

from windup_ai_engine._subject import subject_bbox
from windup_ai_engine.ports import MasterRejectCode, MasterRejected
from windup_ai_engine.postprocess.pack import FILL_H, FILL_W

__all__ = ["MIN_SUBJECT_AREA_RATIO", "MIN_SUBJECT_SIDE", "REJECT_ASPECT",
           "MasterFacts", "check_master", "reject_aspect_for"]

# 主体宽高比上限。**由交付画布的几何推出,不是拍的**:align_bottom_center 按高定标
# (cell*FILL_H);主体 w/h 超过 FILL_W/FILL_H(≈1.55)后宽度兜底接管,交付主体高度
# 退化成 cell*FILL_W/(w/h)。取"退化到目标高度的一半"为界:
#     FILL_W / R < FILL_H / 2  ⇒  R > 2*FILL_W/FILL_H ≈ 3.1
# 再宽就不是"缩小了一点",是把角色压成一条。pack.py 记的实测(2026-08-05):w/h=1.78
# 的狐狸母版丢 27px、w/h=2.0 只剩 79.9% 内容 —— 那还在兜底能救的区间内(交付变矮),
# 3.1 以上则是"硬缩到没法看"。与其硬缩出一个能落库的错产物,不如在花钱前退回去。
REJECT_ASPECT = 2 * FILL_W / FILL_H


def reject_aspect_for(canvas: tuple[int, int] | None) -> float:
    """给定交付画布下的实际比例上限。方形画布(或不指定)即 :data:`REJECT_ASPECT`。

    上面那条推导默认画布是方形 —— ``FILL_W`` 与 ``FILL_H`` 是同一条边长的两个比例。
    画布可以非方之后这个前提就不成立了:宽度兜底是 ``cw*FILL_W/主体宽``、高度目标是
    ``ch*FILL_H/主体高``,同一条推导做下来是

        R = 2 * (cw/ch) * FILL_W / FILL_H = REJECT_ASPECT * (cw/ch)

    即窄高画布(cw<ch)能容纳的主体更扁不了、阈值要按比例收紧。不跟着收的后果是
    **预检按方形判、出帧按非方出**:一个刚好过检的主体在 384×512 画布上交付占高只有
    0.2324,而阈值本意保证的下限是 0.31(实测,见 REJECT_ASPECT 的推导)——正是这条
    阈值存在的意义被悄悄架空。
    """
    if canvas is None:
        return REJECT_ASPECT
    cw, ch = canvas
    return REJECT_ASPECT * (cw / ch)

# 主体包围盒的最短边下限。下游 align_bottom_center 会把包围盒裁出来、NEAREST 放大到
# cell*FILL_H≈159px;8px 放大 20 倍是色块不是角色。更要紧的是:这么小的一块,四角
# 中位色启发式**区分不了它是主体还是一粒压缩噪点/水印**,判"有主体"本身就不成立。
MIN_SUBJECT_SIDE = 8

# 主体像素占画幅的下限。与上一条判的不是同一件事:包围盒管"主体有多大",占比管
# "包围盒里是不是真有东西" —— 画面对角散落两粒噪点会把包围盒撑到整幅,边长检查全过,
# 占比只有百万分之几。千分之一对真角色是极宽松的下限(侧视角色通常占百分之几以上)。
MIN_SUBJECT_AREA_RATIO = 0.001


@dataclass(frozen=True)
class MasterFacts:
    """预检**量到**的母版形态。返回它而不是只返 None:通过时这些数进进度文案,
    出问题时(比如误拒)一眼看得出引擎当时把什么当成了主体。"""

    size: tuple[int, int]                      # 母版画布 (w, h)
    subject_box: tuple[int, int, int, int]     # 主体包围盒 (x0, y0, x1, y1),半开
    subject_ratio: float                       # 主体 w/h
    subject_area_ratio: float                  # 主体像素 / 画幅像素

    def note(self) -> str:
        """给 ProgressPort 的一行摘要(会经 server 变成用户看到的进度文案)。"""
        w, h = self.size
        x0, y0, x1, y1 = self.subject_box
        return (f"母版 {w}×{h},主体 {x1 - x0}×{y1 - y0}"
                f"(w/h {self.subject_ratio:.2f},占幅 {self.subject_area_ratio:.1%})")


def _decode(master: bytes) -> Image.Image:
    """解码母版;坏 bytes 直接拒。

    必须 ``load()`` 强制解完:``Image.open`` 只读文件头,截断的 PNG 在 open 处不报错,
    要到下游某个 ``convert`` / ``np.asarray`` 才炸 —— 那时 i2v 的钱已经花了。
    """
    if not master:
        raise MasterRejected(MasterRejectCode.UNDECODABLE, "母版为空 bytes")
    try:
        img = Image.open(io.BytesIO(master))
        img.load()
        return img.convert("RGBA")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise MasterRejected(
            MasterRejectCode.UNDECODABLE, f"解不开这张图({type(exc).__name__}: {exc})"
        ) from exc


def check_master(master: bytes, canvas: tuple[int, int] | None = None) -> MasterFacts:
    """母版可生成性预检。通过返回量到的形态,不通过抛 :class:`MasterRejected`。

    只看母版本身,不看 ``ActionSpec``:三条判据都是"下游画布装不装得下 / 有没有东西可
    动",与动作类型无关。动作相关的母版要求(侧向 / 蓄力姿态)本层判不了,见模块 docstring。

    ``canvas``:交付画布 ``(宽, 高)``。只影响比例上限 —— 见 :func:`reject_aspect_for`。
    不给即按方形判(与加这个入参之前完全一致)。**必须与出帧用的是同一个 canvas**,
    否则就成了"预检按一套几何判、出帧按另一套出"。
    """
    img = _decode(master)
    w, h = img.size
    found = subject_bbox(img)
    if found is None:
        raise MasterRejected(
            MasterRejectCode.NO_SUBJECT,
            f"{w}×{h} 的图里找不到主体(全透明或全同色),没有可动的东西",
        )
    box, pixels = found
    bw, bh = box[2] - box[0], box[3] - box[1]
    facts = MasterFacts(
        size=(w, h),
        subject_box=box,
        subject_ratio=bw / bh,
        subject_area_ratio=pixels / max(1, w * h),
    )
    if min(bw, bh) < MIN_SUBJECT_SIDE:
        raise MasterRejected(
            MasterRejectCode.SUBJECT_TOO_SMALL,
            f"主体包围盒只有 {bw}×{bh}px(下限 {MIN_SUBJECT_SIDE}px),"
            "与一粒噪点/水印无从区分",
        )
    if facts.subject_area_ratio < MIN_SUBJECT_AREA_RATIO:
        raise MasterRejected(
            MasterRejectCode.SUBJECT_TOO_SMALL,
            f"主体只占画幅 {facts.subject_area_ratio:.4%}"
            f"(下限 {MIN_SUBJECT_AREA_RATIO:.1%}),像散落的噪点而不是角色",
        )
    limit = reject_aspect_for(canvas)
    if facts.subject_ratio > limit:
        raise MasterRejected(
            MasterRejectCode.ASPECT_TOO_WIDE,
            f"主体 w/h={facts.subject_ratio:.2f} 超过 {limit:.2f};"
            "下游画布装不下,再宽只能把角色硬缩成一条,请换一张主体没这么扁的母版",
        )
    return facts
