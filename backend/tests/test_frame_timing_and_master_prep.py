"""逐帧时长与母版预处理 —— 两者都在每次生成的主路径上，此前无直接覆盖。

`frame_durations` 参与每一次出参构造；`prepare_master` 参与每一次 jump / attack 生成。
纯计算，无需联网。
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from windup_ai_engine.postprocess import DEFAULT_FPS_MS, frame_durations
from windup_ai_engine.master_prep import add_headroom, prepare_master


# ── frame_durations ──────────────────────────────────────────────────────────
#
# 契约：等时长会让动作发飘、没有重量感，故各动作有不同基准，关键帧还要加长定格。
# 下面的断言锁的是"动作之间必须有区分度"与"定格必须真的更长"，不是锁具体数值。


def test_durations_length_matches_frame_count():
    assert len(frame_durations("walk", 16)) == 16
    assert frame_durations("walk", 0) == []


def test_each_action_has_its_own_base_duration():
    """idle 慢、run 快 —— 若所有动作退化成同一个值，本用例失败。"""
    idle = frame_durations("idle", 4)[0]
    walk = frame_durations("walk", 4)[0]
    run = frame_durations("run", 4)[0]
    assert idle > walk > run, f"idle={idle} walk={walk} run={run} 应递减"
    assert idle == DEFAULT_FPS_MS["idle"]


def test_unknown_action_falls_back_to_walk_not_zero():
    """未知动作要有可用的兜底，不能返回 0 或抛错——上游动作类型可能先于本模块扩展。"""
    assert frame_durations("no_such_action", 3) == frame_durations("walk", 3)


def test_key_frame_is_held_longer_than_its_neighbours():
    """攻击触点 / 跳跃顶点要定格，否则动作没有重量感。"""
    d = frame_durations("attack", 8, key_frame=3, hold_ms=180)
    assert d[3] == 180
    assert d[3] > d[2] and d[3] > d[4]
    assert sum(1 for x in d if x == 180) == 1, "只应定格一帧"


def test_key_frame_out_of_range_is_ignored_not_crashing():
    """越界的 key_frame 不应炸 —— 帧数由选帧决定，调用方未必对齐。"""
    assert frame_durations("attack", 4, key_frame=99) == frame_durations("attack", 4)
    assert frame_durations("attack", 4, key_frame=-1) == frame_durations("attack", 4)


def test_hold_never_shortens_a_frame():
    """hold_ms 小于基准时长时取基准，定格不能反而变快。"""
    base = DEFAULT_FPS_MS["idle"]          # 450，远大于常见 hold 180
    d = frame_durations("idle", 4, key_frame=1, hold_ms=100)
    assert d[1] == base


# ── prepare_master ───────────────────────────────────────────────────────────
#
# 契约：jump 向上腾空、attack 挥砍过头顶，都会顶出视频画面上沿（实测 attack 15/72 帧触顶）。
# 故这两个动作要在母版顶部补空间，其余动作原样返回。


def _png(w: int, h: int, fill=(200, 60, 60), bg=(18, 220, 30)) -> bytes:
    """一张四角为纯背景色、中下部有主体的图。背景取绿幕色以便断言补边颜色。"""
    img = Image.new("RGB", (w, h), bg)
    for y in range(h // 3, h):
        for x in range(w // 3, w * 2 // 3):
            img.putpixel((x, y), fill)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _size(b: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(b)).size


@pytest.mark.parametrize("action", ["jump", "attack"])
def test_airborne_actions_get_headroom(action: str):
    src = _png(64, 100)
    out = prepare_master(src, action)
    w0, h0 = _size(src)
    w1, h1 = _size(out)
    assert w1 == w0, "宽度不应变化"
    assert h1 > h0, f"{action} 必须补顶部空间，否则腾空时头顶顶出画面被裁"


@pytest.mark.parametrize("action", ["walk", "run", "idle", "hit", "unknown"])
def test_other_actions_are_returned_untouched(action: str):
    """不需要处理的动作必须**原样**返回 —— 无谓的重编码会引入压缩损失。"""
    src = _png(64, 100)
    assert prepare_master(src, action) is src


def test_headroom_is_added_on_top_and_original_sits_at_bottom():
    """补的边必须在**顶部**：原图贴底，顶部新增区域应为背景色。"""
    src = _png(64, 90)
    out = add_headroom(src, ratio=0.6)
    src_img = Image.open(io.BytesIO(src)).convert("RGB")
    out_img = Image.open(io.BytesIO(out)).convert("RGB")
    added = out_img.height - src_img.height
    assert added > 0

    # 顶部新增区域 = 背景色
    assert out_img.getpixel((2, 2)) == src_img.getpixel((0, 0))
    # 原图整体落在底部：最后一行应与原图最后一行一致
    assert out_img.crop((0, out_img.height - 1, out_img.width, out_img.height)).tobytes() == \
           src_img.crop((0, src_img.height - 1, src_img.width, src_img.height)).tobytes()


def test_smaller_ratio_gives_more_headroom():
    """ratio 是"角色占画面高度的比例"，越小顶部留白越多。"""
    src = _png(64, 100)
    _, h_loose = _size(add_headroom(src, ratio=0.5))
    _, h_tight = _size(add_headroom(src, ratio=0.9))
    assert h_loose > h_tight


def test_jump_gets_more_headroom_than_attack():
    """jump 向上腾空，需要的顶部空间比 attack 的过顶挥砍更多（0.62 vs 0.70）。"""
    src = _png(64, 100)
    _, h_jump = _size(prepare_master(src, "jump"))
    _, h_attack = _size(prepare_master(src, "attack"))
    assert h_jump > h_attack


@pytest.mark.parametrize("bad", [0.0, 0.1, 1.0, 1.5, -0.3])
def test_invalid_ratio_raises(bad: float):
    with pytest.raises(ValueError, match="ratio"):
        add_headroom(_png(32, 32), ratio=bad)


def _rgba_png(w: int = 64, h: int = 90) -> bytes:
    """带透明背景的母版：中间一块不透明主体，四周 alpha=0 且 RGB 为 0。

    RGB 取 0 是刻意的 —— 透明像素的 RGB 本来就是未定义值，PIL 抠图产物实测就是 0。
    这正是 ``convert("RGB")`` 会把它当真、整幅变黑的那个输入。
    """
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    im.paste((20, 40, 200, 255), (w // 4, h // 4, w * 3 // 4, h * 3 // 4))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def test_headroom_keeps_alpha_instead_of_flattening_it_to_black():
    """带 alpha 的母版补顶空间后必须仍带 alpha。

    曾经这里无条件 ``convert("RGB")``：透明像素的 RGB 是未定义值（实际为 0），
    整幅底色因此变成纯黑。而 ``add_headroom`` 只被 attack / jump 调用，所以只有这两个
    动作的 i2v 首帧是黑底 —— 模型会自己画一圈白描边把角色从黑底里分出来，而黑发黑裤
    这类深色角色与黑底同色，抠图会在角色内部打洞。
    """
    out = Image.open(io.BytesIO(add_headroom(_rgba_png(), ratio=0.7)))
    assert out.mode == "RGBA", f"补顶空间后 mode={out.mode}，alpha 被丢了"
    assert out.getpixel((2, 2))[3] == 0, "顶部新增区域应保持透明，而不是被填成不透明底色"


def test_attack_and_jump_first_frames_do_not_go_out_on_a_black_canvas():
    """端到端：母版带 alpha 时，三个动作送进 i2v 的画布底色都应是声明的那一个。

    只断言 ``add_headroom`` 保住 alpha 还不够 —— 真正出问题的是它下游那一步：
    不透明输入会让 ``fit_first_frame`` 沿用角点色补边，黑角点就把整张 1280x720 铺黑。
    这条把两步接起来测，锁的是用户实际看到的那个量。
    """
    from windup_framework.providers.protocol.openai_video import (
        FIRST_FRAME_BG,
        fit_first_frame,
    )

    master = _rgba_png()
    for action in ("walk", "attack", "jump"):
        canvas = Image.open(
            io.BytesIO(fit_first_frame(prepare_master(master, action), "1280x720"))
        ).convert("RGB")
        corner = canvas.getpixel((4, 4))
        assert all(abs(a - b) <= 12 for a, b in zip(corner, FIRST_FRAME_BG)), (
            f"{action} 送出去的画布角点 {corner}，应为声明的 {FIRST_FRAME_BG}"
        )
