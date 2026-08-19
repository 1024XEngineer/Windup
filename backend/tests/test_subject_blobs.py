"""subject_blobs 仪器校准:一个会把长剑数成第二个人的计数器比没有计数器更坏。

六种合成掩码逐一钉死连通标记的边界,而不是只测"能跑"——这条计数器的全部价值在于
分得清"真出了第二个角色"与"一条伸出去的长条肢体/道具"，两者搞反了上层会照着
一个假信号提示用户换母版。
"""
from __future__ import annotations

from PIL import Image

from windup_ai_engine.slicing.quality import subject_blobs


def _frame(w: int, h: int, blobs: list[tuple[int, int, int, int]]) -> Image.Image:
    """按矩形拼一帧:每个 (x0, y0, x1, y1) 内 alpha=255,其余透明。"""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for x0, y0, x1, y1 in blobs:
        for y in range(y0, y1):
            for x in range(x0, x1):
                img.putpixel((x, y), (200, 60, 60, 255))
    return img


def test_single_person_counts_as_one_blob():
    """一个连通的躯干+四肢矩形块 —— 最基本的"没有第二主体"场景。"""
    f = _frame(100, 100, [(30, 10, 70, 90)])
    assert subject_blobs([f]) == (1,)


def test_two_disjoint_subjects_count_as_two():
    """两个互不接触、面积相近的块 —— 真出了第二个角色该被计到。"""
    f = _frame(200, 100, [(10, 10, 60, 90), (140, 10, 190, 90)])
    assert subject_blobs([f]) == (2,)


def test_long_held_object_touching_the_body_does_not_count_as_a_second_person():
    """单人持一条横向长剑:剑与握持的手臂像素相连,必须仍是同一个连通块。

    这是本函数存在的核心理由:剑的长条形状与"第二个人形"在面积上可能相当,
    唯一能分开两者的只有连通性 —— 剑与身体之间没有透明缝隙。
    """
    body = (30, 10, 70, 90)          # 躯干
    sword = (68, 40, 190, 46)        # 从躯干右侧伸出的细长剑,与躯干重叠 2px 相接
    f = _frame(200, 100, [body, sword])
    assert subject_blobs([f]) == (1,)


def test_spread_arms_still_count_as_one_blob():
    """双臂从躯干左右张开:与剑同理,张开的肢体不该被误判成独立主体。"""
    torso = (80, 10, 120, 90)
    left_arm = (20, 40, 82, 50)      # 与 torso 左边相接
    right_arm = (118, 40, 180, 50)   # 与 torso 右边相接
    f = _frame(200, 100, [torso, left_arm, right_arm])
    assert subject_blobs([f]) == (1,)


def test_tiny_noise_speck_is_filtered_by_min_area_ratio():
    """主体旁一粒远小于 min_area_ratio 的噪点必须被滤掉,不计入块数。"""
    main = (30, 10, 70, 90)    # 40*80 = 3200px
    speck = (95, 95, 98, 98)   # 3*3 = 9px,占比 9/3200 ≈ 0.0028 < 0.15
    f = _frame(200, 200, [main, speck])
    assert subject_blobs([f]) == (1,)


def test_fully_transparent_frame_has_zero_blobs():
    f = _frame(50, 50, [])
    assert subject_blobs([f]) == (0,)


def test_returns_per_frame_counts_not_an_average():
    """分布形态对应不同的病:全程 2 块与只有中段 2 块含义不同,不能被压成一个均值。"""
    one = _frame(100, 100, [(30, 10, 70, 90)])
    two = _frame(100, 100, [(10, 10, 40, 90), (60, 10, 90, 90)])
    result = subject_blobs([one, two, one])
    assert result == (1, 2, 1)
    assert isinstance(result, tuple)
