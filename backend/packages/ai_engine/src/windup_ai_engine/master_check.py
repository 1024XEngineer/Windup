"""母版可生成性预检 —— 入口处**允许拒绝**的那道闸,在花钱之前。

为什么有这个模块:ai_engine 此前所有 ``raise`` 都在输出侧,``generate(card, action,
master, progress)`` 对 ``master`` 一个前置判定都没有。2026-08-07 实测:喂一张"人物在
画板前作画"的图请求 walk,全程无一处报错,最终产出 16 帧构图完整的序列帧,画面是个
不会走路的错角色 —— 钱已花完才发现。

**本层判什么(全部本地零成本、可复现)**

*拒绝(:class:`MasterRejected`,量到就是事实):*
  ① 能否解码 —— 坏 bytes / 截断文件不必等 i2v 跑完再发现;
  ② 有没有可动的主体 —— 全透明 / 全同色 = 画面里没有东西可动;
  ③ 主体宽高比下游装不装得下 —— 见 :data:`REJECT_ASPECT`。

*警告(:class:`MasterWarning`,近似判据,合法母版也会命中):*
  ④ 下半身横切的连通段数 —— 见 :data:`LIMB_BANDS`;
  ⑤ 主体之外还有没有独立色块 —— 见 :data:`MIN_EXTRA_COMPONENT_RATIO`。

拒绝与警告的分界**由判据能不能证伪决定,不由后果严重程度决定**。④⑤ 指向的是混元图生 3D
的硬约束(四肢粘连 → 绑骨绑不出腿;画面里有武器配件 → 明确不允许),后果比 ③ 更贵,
但两条判据都会在合法母版上误报,所以只能警告。**上层拿它们做什么决定**:摆在母版确认闸
上给人看,让人在花 ¥2.40 建 3D 之前决定"就用这张 / 重新生成三张";任何一条都不阻断流程。

**本层不判什么、为什么 —— 别把下面这些当成已经守住了:**
  - **画面里有没有文字**(提示词含 "reference sheet" 时生图模型会自己糊上标注,烤进母版
    就带到每一帧)。**这条明确不做。** 纯 numpy 能做的文字信号(局部高频、笔画宽度一致、
    小连通块成行排列)在像素画角色身上恒亮:铆钉、扣子、牙齿、瞳孔高光全是"小而密的
    高对比块"。做出来的东西假阳性远多于真阳性,而假阳性会让人把一张好母版扔掉重生成 ——
    比漏报更贵。要真做,得上 OCR / 检测模型,那是一次按次计费的调用,与"零成本预检"
    不是一件事,得单独立项与实测。
  - **和身体焊在一起的手持物**。⑤ 只逮得到与主体**不相连**的色块;剑握在手里、与手臂
    连成一片时它一个信号都没有 —— 与 ``providers.render3d.checks`` 那层"融进同一块网格的
    武器逮不到"是同一个盲区的上下两端。
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
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, UnidentifiedImageError

from windup_ai_engine._subject import bbox_of, subject_mask
from windup_ai_engine.ports import (
    MasterRejectCode,
    MasterRejected,
    MasterWarning,
    MasterWarningCode,
)
from windup_ai_engine.postprocess.pack import FILL_H, FILL_W

__all__ = ["LIMB_BANDS", "MIN_EXTRA_COMPONENT_RATIO", "MIN_LIMB_RUN_PX",
           "MIN_SUBJECT_AREA_RATIO", "MIN_SUBJECT_SIDE", "REJECT_ASPECT",
           "MasterFacts", "check_master", "component_sizes", "limb_segments",
           "main_component", "reject_aspect_for"]

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

# 在主体高度的这几处横切,数一行里有几段主体像素。取值全部落在**下半身**:
# 0.70 大腿、0.80 膝、0.88 小腿、0.94 踝。双足人形在这几处应稳定量到 2 段;
# 掉到 1 段意味着两腿之间没有空隙 —— 混元的绑骨要靠这道空隙分出左右腿。
#
# 为什么是四处而不是一处:单处会被一次偶然的遮挡(裙摆下摆、披风、站姿交叉)否掉,
# 而"四处全都只有 1 段"才是形态问题。判据取 ``max(段数) >= 2`` 通过。
LIMB_BANDS = (0.70, 0.80, 0.88, 0.94)

# 一段至少这么宽才算数。描边、抗锯齿会在腿外侧留下 1–2px 的孤立像素,
# 不滤掉的话一条腿会被数成三段,"分离"反而被误判成"更分离"。
MIN_LIMB_RUN_PX = 3

# 独立色块要达到最大块的这个比例才当成"另一个东西"。抗锯齿碎片、发梢、飞溅特效
# 都会产生小连通块,阈值太低会让几乎每张母版都报警,而报警一多就没人看了。
MIN_EXTRA_COMPONENT_RATIO = 0.02


def _runs(row: np.ndarray, min_px: int = 1) -> list[tuple[int, int]]:
    """一行里的连通段 ``[(x0, x1), ...]``(半开),短于 ``min_px`` 的丢掉。"""
    edges = np.flatnonzero(np.diff(np.concatenate(([0], row.astype(np.int8), [0]))))
    return [(int(a), int(b)) for a, b in zip(edges[::2], edges[1::2], strict=True)
            if b - a >= min_px]


def limb_segments(mask: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, ...]:
    """:data:`LIMB_BANDS` 各处的横向连通段数,与 ``LIMB_BANDS`` 一一对应。"""
    x0, y0, x1, y1 = box
    span = y1 - y0 - 1
    return tuple(
        len(_runs(mask[min(y1 - 1, y0 + int(round(frac * span))), x0:x1], MIN_LIMB_RUN_PX))
        for frac in LIMB_BANDS
    )


def _label(mask: np.ndarray) -> tuple[list[tuple[int, int, int, int]], dict[int, int]]:
    """连通块标注:``[(y, x0, x1, root), ...]`` + 各 root 的像素总数。**八邻接**。

    按行的连通段做并查集而不是逐像素扫:段数比像素数小三四个数量级,一张 1024² 的母版
    只有几千段。八邻接是刻意的 —— 四邻接会把抗锯齿造成的对角细颈判成断开,于是同一条
    手臂被数成两块,凭空多出一个"独立色块"警告。
    """
    parent: list[int] = []

    def find(i: int) -> int:
        root = i
        while parent[root] != root:
            root = parent[root]
        while parent[i] != root:
            parent[i], i = root, parent[i]
        return root

    labelled: list[tuple[int, int, int, int]] = []
    previous: list[tuple[int, int, int]] = []
    for y in range(mask.shape[0]):
        current: list[tuple[int, int, int]] = []
        for a, b in _runs(mask[y]):
            label = len(parent)
            parent.append(label)
            for pa, pb, plabel in previous:
                if a <= pb and pa <= b:          # 端点相碰即视为连通 = 八邻接
                    ra, rb = find(label), find(plabel)
                    if ra != rb:
                        parent[rb] = ra
            labelled.append((y, a, b, label))
            current.append((a, b, label))
        previous = current

    resolved = [(y, a, b, find(label)) for y, a, b, label in labelled]
    totals: dict[int, int] = {}
    for _, a, b, root in resolved:
        totals[root] = totals.get(root, 0) + (b - a)
    return resolved, totals


def component_sizes(mask: np.ndarray) -> tuple[int, ...]:
    """各连通块的像素数,从大到小。"""
    return tuple(sorted(_label(mask)[1].values(), reverse=True))


def main_component(mask: np.ndarray) -> np.ndarray:
    """只保留最大连通块的掩码 —— 数腿之前必须先把画面里的别的东西剔掉。

    不剔的后果是两条警告互相架空:一把浮在腿侧的剑会在腿所在的那几行多贡献一段,
    于是"两腿粘连"被凑够 2 段、警告消失 —— 母版越糟糕反而越安静。
    """
    runs, totals = _label(mask)
    if not totals:
        return mask
    root = max(totals.items(), key=lambda kv: (kv[1], -kv[0]))[0]
    out = np.zeros_like(mask)
    for y, a, b, r in runs:
        if r == root:
            out[y, a:b] = True
    return out


@dataclass(frozen=True)
class MasterFacts:
    """预检**量到**的母版形态。返回它而不是只返 None:通过时这些数进进度文案,
    出问题时(比如误拒)一眼看得出引擎当时把什么当成了主体。"""

    size: tuple[int, int]                      # 母版画布 (w, h)
    subject_box: tuple[int, int, int, int]     # 主体包围盒 (x0, y0, x1, y1),半开
    subject_ratio: float                       # 主体 w/h
    subject_area_ratio: float                  # 主体像素 / 画幅像素
    limb_segments: tuple[int, ...] = ()        # LIMB_BANDS 各处的横向连通段数
    components: tuple[int, ...] = ()           # 够大的连通块像素数,从大到小
    warnings: tuple[MasterWarning, ...] = field(default_factory=tuple)

    def note(self) -> str:
        """给 ProgressPort 的一行摘要(会经 server 变成用户看到的进度文案)。"""
        w, h = self.size
        x0, y0, x1, y1 = self.subject_box
        tail = f";{len(self.warnings)} 条警告" if self.warnings else ""
        return (f"母版 {w}×{h},主体 {x1 - x0}×{y1 - y0}"
                f"(w/h {self.subject_ratio:.2f},占幅 {self.subject_area_ratio:.1%})"
                f"{tail}")


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


def _warnings(
    segments: tuple[int, ...], blocks: tuple[int, ...]
) -> tuple[MasterWarning, ...]:
    """把量到的两组数翻成警告。**只在信号明确时出声** —— 详见各条的假阳性来源。"""
    out: list[MasterWarning] = []
    if segments and max(segments) < 2:
        out.append(MasterWarning(
            MasterWarningCode.LIMBS_FUSED,
            f"下半身 {list(LIMB_BANDS)} 四处横切都只有 {list(segments)} 段主体像素,"
            "两腿之间量不到空隙。混元靠这道空隙分左右腿,粘连时会绑出一条腿的骨架,"
            "而接口不会报错。**侧视角色两腿前后重叠时本条必然误报**,"
            "确认这张是侧视就忽略它。",
        ))
    if len(blocks) > 1:
        extra = ", ".join(f"{n}px" for n in blocks[1:])
        out.append(MasterWarning(
            MasterWarningCode.EXTRA_COMPONENT,
            f"主体({blocks[0]}px)之外还有 {len(blocks) - 1} 块独立色块({extra})。"
            "混元明写送检模型不得含人体以外的组件,画面里的武器/道具会被一起建进网格、"
            "再被绑上权重乱甩。也可能是生图模型自己糊上的标注文字。"
            "**与身体相连的手持物本条逮不到**,只能靠人看。",
        ))
    return tuple(out)


def check_master(master: bytes, canvas: tuple[int, int] | None = None) -> MasterFacts:
    """母版可生成性预检。通过返回量到的形态(含警告),不通过抛 :class:`MasterRejected`。

    只看母版本身,不看 ``ActionSpec``:拒绝那三条都是"下游画布装不装得下 / 有没有东西可
    动",与动作类型无关。动作相关的母版要求(侧向 / 蓄力姿态)本层判不了,见模块 docstring。

    警告**不影响返回**:调用方拿到 facts 就是通过了,``facts.warnings`` 要不要理是它的事。
    这样定是因为两条警告判据都会在合法母版上误报,让它们阻断流程等于把误报变成挡路。

    ``canvas``:交付画布 ``(宽, 高)``。只影响比例上限 —— 见 :func:`reject_aspect_for`。
    不给即按方形判(与加这个入参之前完全一致)。**必须与出帧用的是同一个 canvas**,
    否则就成了"预检按一套几何判、出帧按另一套出"。
    """
    img = _decode(master)
    w, h = img.size
    mask = subject_mask(img)
    found = bbox_of(mask)
    if found is None:
        raise MasterRejected(
            MasterRejectCode.NO_SUBJECT,
            f"{w}×{h} 的图里找不到主体(全透明或全同色),没有可动的东西",
        )
    box, pixels = found
    bw, bh = box[2] - box[0], box[3] - box[1]
    body = main_component(mask)
    body_box = bbox_of(body)
    segments = limb_segments(body, body_box[0]) if body_box else ()
    blocks = component_sizes(mask)
    kept = tuple(n for n in blocks if n >= blocks[0] * MIN_EXTRA_COMPONENT_RATIO)
    facts = MasterFacts(
        size=(w, h),
        subject_box=box,
        subject_ratio=bw / bh,
        subject_area_ratio=pixels / max(1, w * h),
        limb_segments=segments,
        components=kept,
        warnings=_warnings(segments, kept),
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
