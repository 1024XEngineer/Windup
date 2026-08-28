"""交付帧不许把角色的头裁掉(#604)。

生产实测:任务 604(老妇待机,veo 出的源视频)32 帧里 **9 帧顶边贴 y=0、头顶被平切**,
而源视频里头是完整的、四周留白很足。链上的事实:

    fill_h = min(FOOT_LINE, 母版主体占幅)   → 这个母版占幅高,fill_h 顶到 0.92 = 脚线
    scale  = ch*fill_h / median(本体跨度)    → 按构造约一半的帧高于目标高度
    top    = ch*foot_line - h                → h 超了就是负数
    alpha_composite(crop, (x, top))          → 负坐标**静默**裁掉顶部

而帧数、时长、脚线、成色全部正常,没有任何一处报错。同一个函数在**宽度**方向既夹取
(``scale = min(scale, (cw*fill_w)/max_core)``)又打日志,高度方向两样都没有。
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from windup_ai_engine.postprocess.pack import FOOT_LINE, align_bottom_center


def _figure(h: int, body_w: int = 60, head_w: int = 24, canvas: int = 400) -> Image.Image:
    """一个立在画布底部、**头比身体窄**的人形。``h`` 是总高。

    头必须比身体窄:这样"被切"才可判 —— 切到身体那一层,顶行宽度就是身体宽;
    头完整时顶行宽度是头宽。生产 #604 第 0 帧顶行 70 个不透明像素,正是身体那么宽的
    一条横切面,而不是头顶。只断言"顶行有没有像素"会把**贴边**误判成**被切**。
    """
    a = np.zeros((canvas, canvas, 4), dtype=np.uint8)
    y1 = canvas - 20                      # 脚离画布底 20px
    head_h = max(6, h // 5)
    bx = (canvas - body_w) // 2
    hx = (canvas - head_w) // 2
    a[y1 - h + head_h:y1, bx:bx + body_w] = (200, 180, 160, 255)   # 身体
    a[y1 - h:y1 - h + head_h, hx:hx + head_w] = (230, 210, 190, 255)  # 头
    return Image.fromarray(a, "RGBA")


def _top_row_width(im: Image.Image) -> int:
    """交付帧顶行的不透明像素数。头完整 → 约等于头宽;切到身体 → 约等于身体宽。"""
    arr = np.asarray(im)[:, :, 3]
    return int((arr[0] > 128).sum())


def _head_is_intact(im: Image.Image, body_w_scaled: float) -> bool:
    """顶行没有宽到身体那一层,就说明没切进身体。"""
    return _top_row_width(im) < body_w_scaled * 0.7


# #604 的形状:老妇从直立慢慢弯腰,身高随姿态变化。中位数定标会让直立那几帧超出。
_UPRIGHT, _BENT = 300, 250
POSES = [_UPRIGHT] * 12 + [_BENT] * 20          # 直立少、弯腰多 → 中位数落在弯腰那档


def test_the_tallest_pose_is_not_clipped_at_the_top():
    """拦的坏例:#604 —— 中位数定标 + 零余量,直立帧的头被平切。

    判据是"顶行没有不透明像素",不是"看起来还行"。头被切时顶行会是一整条横切面
    (实测 #604 第 0 帧顶行 70 个不透明像素)。
    """
    frames = [_figure(h) for h in POSES]
    out = align_bottom_center(frames, cell=256, fill_h=FOOT_LINE, resample=Image.Resampling.NEAREST)
    # 交付后的身体宽:用最矮那帧量(它一定没被裁),作为"切到身体"的判据基准。
    body_scaled = max(_top_row_width(im) for im in out) or 1
    ref = out[POSES.index(min(POSES))]
    bb = ref.split()[-1].getbbox()
    body_scaled = bb[2] - bb[0]
    clipped = [i for i, im in enumerate(out) if not _head_is_intact(im, body_scaled)]
    assert not clipped, (
        f"{len(clipped)}/{len(out)} 帧切进了身体(帧号 {clipped[:8]});"
        "这正是 #604 的形状 —— 头被平切而帧数/时长/脚线/成色全部正常"
    )


def test_the_feet_stay_on_the_foot_line():
    """夹取不能靠把角色往下挪来避开裁剪 —— 那会让她不站在地上。

    这条是上一条的对照:光让顶部不裁很容易(整体下移即可),但脚线是这条管线的核心
    契约(#21 逐帧对齐、跨动作一致都建在它上面)。
    """
    frames = [_figure(h) for h in POSES]
    out = align_bottom_center(frames, cell=256, fill_h=FOOT_LINE, resample=Image.Resampling.NEAREST)
    want = int(256 * FOOT_LINE)
    for i, im in enumerate(out):
        bb = im.split()[-1].getbbox()
        assert bb is not None and abs(bb[3] - want) <= 1, f"第 {i} 帧脚线 {bb[3]}，应为 {want}"


def test_all_frames_keep_one_shared_scale():
    """夹取之后仍然是整段共用一个缩放系数,不是逐帧各自归一化。

    逐帧归一化会把姿态造成的身高起伏反向变成"忽大忽小"(本函数 docstring 的原意)。
    所以直立帧与弯腰帧的高度比,必须仍然等于它们原始高度的比。
    """
    frames = [_figure(h) for h in POSES]
    out = align_bottom_center(frames, cell=256, fill_h=FOOT_LINE, resample=Image.Resampling.NEAREST)
    hs = [im.split()[-1].getbbox()[3] - im.split()[-1].getbbox()[1] for im in out]
    tall, short = max(hs), min(hs)
    assert abs(tall / short - _UPRIGHT / _BENT) < 0.05, (
        f"交付高度比 {tall/short:.3f} 与原始比 {_UPRIGHT/_BENT:.3f} 不符 —— 像是逐帧归一化了"
    )


def test_a_raised_extremity_may_overflow_but_the_body_may_not():
    """举过头顶的武器可以溢出被裁(与翅尖同档),但本体必须完整。

    按整体包围盒夹取会让举武器那一帧把整段压小(实测人形举武器 68.4%),那比武器尖
    缺一点严重得多 —— 与宽度方向的取舍是同一条。
    """
    frames = [_figure(_BENT) for _ in range(8)]
    # 第 3 帧加一根细长"武器",高出头顶很多但很薄
    arr = np.asarray(frames[3]).copy()
    cx = arr.shape[1] // 2
    arr[10:arr.shape[0] - 20, cx - 2:cx + 2] = (255, 255, 255, 255)
    frames[3] = Image.fromarray(arr, "RGBA")

    out = align_bottom_center(frames, cell=256, fill_h=FOOT_LINE, resample=Image.Resampling.NEAREST)
    # 本体那几帧一律不许被裁
    bb = out[0].split()[-1].getbbox()
    for i in (0, 1, 2, 4, 5, 6, 7):
        assert _head_is_intact(out[i], bb[2] - bb[0]), f"第 {i} 帧本体被裁了"
    # 而角色本体没有因为那一帧被压小
    body = out[0].split()[-1].getbbox()
    assert (body[3] - body[1]) > 256 * FOOT_LINE * 0.75, "角色被那根武器压得太小"


def test_drift_compensation_cannot_push_a_frame_back_over_the_top():
    """拦的坏例:夹取放在漂移补偿**之前**算。

    实际用的是 ``scale * per_frame[idx]``。i2v 常有单调推镜(整段尺度漂移),本函数会
    逐帧补偿把趋势项除掉,补偿系数以 1.0 为中心 —— 也就是**有些帧的系数大于 1**。
    先夹后补偿等于没夹:被补偿放大的那几帧照样顶出画布。

    (这个错我写过一遍:第一版把夹取放在 per_frame 之前,测出来仍有 12/32 帧被切。)
    """
    # 单调放大的一段(推镜),让 scale_drift 真的算出补偿
    poses = [220 + i * 4 for i in range(24)]
    frames = [_figure(h) for h in poses]
    out = align_bottom_center(frames, cell=256, fill_h=FOOT_LINE,
                              resample=Image.Resampling.NEAREST)
    ref = out[0].split()[-1].getbbox()
    body_scaled = ref[2] - ref[0]
    clipped = [i for i, im in enumerate(out) if not _head_is_intact(im, body_scaled)]
    assert not clipped, f"补偿放大的帧被切了:{clipped[:8]}"
