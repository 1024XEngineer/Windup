"""OnnxU2NetMatteProvider 契约测试(不加载模型 / 不联网:构造 + 协议合规)。"""

import numpy as np
from PIL import Image
import pytest

from windup_framework.providers import MatteProvider, OnnxU2NetMatteProvider


def test_onnx_matte_satisfies_matte_provider_protocol():
    # 运行时可检查协议:有 cutout 即满足 MatteProvider(server/ai_engine 依赖此契约)
    provider = OnnxU2NetMatteProvider(model_path="/nonexistent/u2netp.onnx")
    assert isinstance(provider, MatteProvider)
    assert callable(provider.cutout)


def test_onnx_matte_lazy_no_model_load_on_construct():
    # 构造不触发下载 / 会话创建(惰性),模型缺失也不报错
    provider = OnnxU2NetMatteProvider(model_path="/nonexistent/u2netp.onnx")
    assert provider._session is None


# ── 底色清理（2026-08-07 实测挣得）────────────────────────────────────────────


def _rgb(w, h, bg, blob=None):
    import numpy as np
    a = np.zeros((h, w, 3), dtype=np.float32)
    a[:, :] = bg
    if blob:
        (x0, y0, x1, y1), c = blob
        a[y0:y1, x0:x1] = c
    return a


def test_flat_background_is_killed_but_subject_untouched():
    """纯色底 → 系数 0（会被清掉）；主体色 → 系数 1（一像素不动）。"""
    from windup_framework.providers.matte import _flat_bg_penalty

    bg = (222, 41, 124)          # 实测的玫红底
    fur = (222, 130, 70)         # 铁锈橙毛：与底色红通道相同，欧氏距离仅约 104
    a = _rgb(80, 60, bg, blob=((20, 15, 60, 45), fur))
    p = _flat_bg_penalty(a)
    assert p[2, 2] == 0.0, "四角纯背景必须被判为 0"
    assert p[30, 40] == 1.0, "橙毛必须完全不受影响 —— 宽阈值会把它反解成绿色"


def test_enclosed_background_gap_is_killed():
    """被主体围住的背景空隙也要清掉 —— u2netp 对闭合区域天然失灵。"""
    from windup_framework.providers.matte import _flat_bg_penalty

    bg = (222, 41, 124)
    a = _rgb(80, 60, bg, blob=((16, 16, 64, 44), (100, 120, 140)))  # 避开取样用的 12×12 角落
    a[24:34, 30:50] = bg          # 主体内部挖一个洞，填回底色
    p = _flat_bg_penalty(a)
    assert p[30, 40] == 0.0, "闭合空隙里的底色必须被清掉"
    assert p[20, 20] == 1.0, "洞外的主体不受影响"


def test_non_flat_background_disables_cleanup_entirely():
    """底色不均匀时一律不清理 —— 宁可漏，不可误伤。"""
    import numpy as np

    from windup_framework.providers.matte import _flat_bg_penalty

    rng = np.random.default_rng(0)
    noisy = rng.uniform(0, 255, (60, 80, 3)).astype(np.float32)
    assert (_flat_bg_penalty(noisy) == 1.0).all()


def test_cleanup_only_subtracts_never_adds_subject():
    """系数恒在 [0,1] —— 只做减法，最坏情况是少清理，不会凭空造出主体。"""
    from windup_framework.providers.matte import _flat_bg_penalty

    a = _rgb(40, 40, (0, 255, 0), blob=((5, 5, 35, 35), (200, 60, 60)))
    p = _flat_bg_penalty(a)
    assert p.min() >= 0.0 and p.max() <= 1.0


def test_missing_onnxruntime_raises_instead_of_guessing_background():
    """装不上就报出来，不能回落到"猜四角主色"——白底浅色角色会被抠穿。"""
    import builtins

    import pytest

    from windup_framework.providers.matte import OnnxU2NetMatteProvider

    real = builtins.__import__

    def blocked(name, *a, **k):
        if name == "onnxruntime":
            raise ImportError("blocked for test")
        return real(name, *a, **k)

    builtins.__import__ = blocked
    try:
        with pytest.raises(RuntimeError, match="onnxruntime"):
            OnnxU2NetMatteProvider()._get_session()
    finally:
        builtins.__import__ = real


# ── 视频帧的最外圈是编码器伪影，不是底色（2026-08-10 实测挣得）──────────────


def test_edge_artifact_row_does_not_disable_cleanup():
    """最外一行/列常是编码器伪影：贴边采样会把它算进"底色是否均匀"，
    于是整帧被判"底不均匀"而跳过清理——修复在真实路径上等于从不生效。

    实测 9 段真 i2v × 16 帧 = 144 帧，贴边采样时 26 帧（18%）因此误跳；
    往里让 2px 后归零。
    """
    import numpy as np

    from windup_framework.providers.matte import _flat_bg_penalty

    bg = (222, 41, 124)
    a = np.zeros((80, 80, 3), dtype=np.float32)
    a[:, :] = bg
    a[:, -1] = (0, 0, 0)          # 最右一列纯黑：典型的编码器边缘伪影
    a[0, :] = (180, 30, 100)      # 最顶一行偏暗
    p = _flat_bg_penalty(a)
    assert p[40, 40] == 0.0, "跳过最外圈后应认出这是纯色底并清理；贴边采样会误判为不均匀"


def test_tiny_image_degrades_to_no_cleanup_rather_than_guessing():
    """图小到四角采样块会盖住主体时，采出来的"底色"其实混了主体色，
    此时守卫判"底不均匀"、整体跳过清理。

    这是**安全的退化方向**：清理只做减法，跳过等于少清一点；反过来若强行按
    混了主体色的 key 去清，会把主体本身当背景抠掉——本项目宁可漏，不可误伤。
    """
    import numpy as np

    from windup_framework.providers.matte import _flat_bg_penalty

    a = np.zeros((20, 20, 3), dtype=np.float32)
    a[:, :] = (0, 255, 0)
    a[8:12, 8:12] = (200, 60, 60)     # 主体落在四角采样块的重叠区
    assert (_flat_bg_penalty(a) == 1.0).all(), "采样不可靠时必须整体跳过，而不是按脏 key 清理"


# ── 封闭空洞填充（2026-08-11 在 121 帧真实走路视频帧上实测挣得）──────────────────
#
# 背景:交付帧放大看,主体内部会有透明洞(背景直接透出来)。实测拆开成因:
#   · u2netp 自身在主体内部造的洞:8 帧抽样里 6 帧为 0 —— 不是主要成因;
#   · 键控误杀:_flat_bg_penalty 每帧杀掉 820~2346 个 u2netp 判为主体的像素 ——
#     浅肤色 (243,221,200) 到灰底 (219,219,220) 的欧氏距离只有 31.3,窄于 _KEY_KILL=38。
# 这些被误杀的像素被主体围住,正是"封闭空洞",填回来即修复。
#
# 但**只按"不与画面边界连通"判定会把两腿之间填实**:迈步相里两只靴子在下方交叠,
# 把腿间空隙彻底封死。实测 121 帧中 80 帧存在这种封闭的底色空隙,共 25173 像素;
# 朴素版(只判连通性)把这 25173 像素全部填成主体(最惨单帧 3172 像素,两腿焊死),
# 加了颜色守卫后填掉 0 像素。下面的用例把这条守住。


def _walk_frame(*, gap_closed: bool, hole: bool = False, eroded_leg: bool = False):
    """造一帧"迈步相":灰底 + 躯干 + 两条腿 + 腿间底色空隙。

    ``gap_closed=True`` 时靴子在下方交叠、把腿间空隙封死(实测 80/121 帧是这形状)。
    颜色取实测值:底 (219,219,220)、浅肤 (243,221,200)(两者距离 31.3,窄于 _KEY_KILL)。
    返回 (rgb float32, alpha float32)。
    """
    import numpy as np

    bg, skin, cloth = (219, 219, 220), (243, 221, 200), (110, 130, 100)
    h, w = 64, 64
    rgb = np.full((h, w, 3), bg, dtype=np.float32)
    alpha = np.zeros((h, w), dtype=np.float32)

    def paint(y0, y1, x0, x1, color):
        rgb[y0:y1, x0:x1] = color
        alpha[y0:y1, x0:x1] = 1.0

    paint(8, 32, 20, 44, cloth)          # 躯干
    paint(32, 52, 20, 28, skin)          # 后腿
    paint(32, 52, 36, 44, skin)          # 前腿
    if gap_closed:
        paint(52, 58, 20, 44, cloth)     # 靴子交叠 → 腿间空隙被封死
    else:
        paint(52, 58, 20, 28, cloth)     # 两只靴子分开 → 空隙通到画面底边
        paint(52, 58, 36, 44, cloth)
    if hole:
        alpha[14:20, 28:36] = 0.0        # 躯干内部的洞:颜色还是衣服色
    if eroded_leg:
        alpha[36:46, 22:26] = 0.0        # 腿内部被键控误杀的一条:颜色是浅肤色
    return rgb, alpha


def _gap_slice():
    """腿间空隙区域(rgb 一直是底色,alpha 一直应为 0)。"""
    return (slice(32, 52), slice(28, 36))


def test_enclosed_hole_in_subject_is_filled():
    """被主体围住、颜色不是底色的透明块 = 洞,填成主体。"""
    from windup_framework.providers.matte import _fill_enclosed_holes

    rgb, alpha = _walk_frame(gap_closed=True, hole=True)
    out = _fill_enclosed_holes(alpha, rgb)
    assert (out[14:20, 28:36] == 1.0).all(), "躯干内部的洞必须被填成主体"


def test_keyed_out_skin_inside_leg_is_filled():
    """被 _flat_bg_penalty 误杀的浅肤色(实测每帧 820~2346 px)要能填回来。"""
    from windup_framework.providers.matte import _fill_enclosed_holes

    rgb, alpha = _walk_frame(gap_closed=True, eroded_leg=True)
    out = _fill_enclosed_holes(alpha, rgb)
    assert (out[36:46, 22:26] == 1.0).all(), "浅肤色距底色 31.3,不是底色,必须填回主体"


def test_closed_leg_gap_is_never_filled():
    """**核心回归**:靴子交叠把腿间空隙封死时,它照样不能被填 —— 否则两腿焊在一起。

    实测:只判"不与边界连通"的朴素版在这里会把整块空隙填掉(121 帧共 25173 px)。
    """
    from windup_framework.providers.matte import _fill_enclosed_holes

    rgb, alpha = _walk_frame(gap_closed=True)
    ys, xs = _gap_slice()
    assert (alpha[ys, xs] == 0.0).all(), "前提:空隙本来是透明的"
    out = _fill_enclosed_holes(alpha, rgb)
    assert (out[ys, xs] == 0.0).all(), "腿间空隙整块是底色,一个像素都不能填"


def test_open_leg_gap_is_never_filled():
    """空隙通到画面底边时同样不能填 —— 这条也钉死"绝不能按行/按列填"。

    按行填会看到"这一行左右都是主体"就把中间填上,正是这里要拦的。
    """
    from windup_framework.providers.matte import _fill_enclosed_holes

    rgb, alpha = _walk_frame(gap_closed=False)
    ys, xs = _gap_slice()
    out = _fill_enclosed_holes(alpha, rgb)
    assert (out[ys, xs] == 0.0).all(), "与边界连通的空隙不是洞"
    assert (out == alpha).all(), "没有洞的帧必须逐像素不变"


def test_border_touching_transparent_area_is_never_filled():
    """贴着画幅边缘的透明区域不是洞 —— 哪怕它的颜色一点也不像底色。

    真实场景:i2v 出的帧经常把角色下半身裁出画,两腿之间是一条暗投影(不是干净底色),
    这条投影只从画幅下沿通向画外,左右被两条腿封死。只靠"颜色像不像底色"判断会把
    它当成洞、填成主体(两腿又焊上了),所以"从边界出发"这条种子必须保留。
    """
    from windup_framework.providers.matte import _fill_enclosed_holes

    rgb, alpha = _walk_frame(gap_closed=False)
    for x0, x1 in ((20, 28), (36, 44)):          # 两条腿一直延到画幅下沿
        rgb[52:64, x0:x1] = (110, 130, 100)
        alpha[52:64, x0:x1] = 1.0
    rgb[32:64, 28:36] = (60, 55, 50)             # 腿间暗投影:远离底色
    alpha[32:64, 28:36] = 0.0                    # 只从下沿通向画外,左右被腿封死

    out = _fill_enclosed_holes(alpha, rgb)
    assert (out[32:64, 28:36] == 0.0).all(), "连到画幅边界的透明区域一律不是洞"


def test_frame_without_holes_is_pixel_identical():
    """没有洞 → 逐像素不变(防回归硬指标)。"""
    import numpy as np

    from windup_framework.providers.matte import _fill_enclosed_holes

    rgb, alpha = _walk_frame(gap_closed=True)
    out = _fill_enclosed_holes(alpha, rgb)
    assert np.array_equal(out, alpha)


def test_fill_only_adds_alpha_never_removes():
    """只做加法:alpha 绝不被改小,改动值只能是 1.0 —— 填洞不该顺手抠掉别的。"""
    from windup_framework.providers.matte import _fill_enclosed_holes

    rgb, alpha = _walk_frame(gap_closed=True, hole=True, eroded_leg=True)
    out = _fill_enclosed_holes(alpha, rgb)
    assert (out >= alpha).all()
    assert (out[out != alpha] == 1.0).all()


def test_non_flat_background_disables_fill_entirely():
    """底色不均匀 → 无从判断哪块是真空隙,一律不填(与键控清理同一条纪律)。"""
    import numpy as np

    from windup_framework.providers.matte import _fill_enclosed_holes

    rgb, alpha = _walk_frame(gap_closed=True, hole=True)
    rng = np.random.default_rng(0)
    noisy = rng.uniform(0, 255, rgb.shape).astype(np.float32)
    out = _fill_enclosed_holes(alpha, noisy)
    assert np.array_equal(out, alpha), "底不是纯色时必须整帧不动"


def test_bg_key_returns_none_when_background_is_not_flat():
    """底色真相源:不均匀时返回 None,键控与填洞都据此停手。"""
    import numpy as np

    from windup_framework.providers.matte import _bg_key

    rng = np.random.default_rng(1)
    assert _bg_key(rng.uniform(0, 255, (40, 40, 3)).astype(np.float32)) is None
    assert _bg_key(np.full((40, 40, 3), 219, dtype=np.float32)) is not None


def test_spread_is_four_connected_not_scanline():
    """扩散必须是真 4-邻接连通:L 形走廊要能拐弯走通,断开的孤岛不能被沾到。

    只做行传播(或只做列传播)都会让 L 形的另一条臂走不通,这条用例把两个方向都钉死。
    """
    import numpy as np

    from windup_framework.providers.matte import _spread

    region = np.zeros((20, 20), dtype=bool)
    region[2, 2:18] = True        # 横臂
    region[2:18, 17] = True       # 竖臂(拐弯)
    island = (15, 3)
    region[island] = True         # 孤岛:与走廊不连通
    seed = np.zeros_like(region)
    seed[2, 2] = True

    reach = _spread(seed, region)
    assert reach[2, 17], "横臂尽头要走通(需要行传播)"
    assert reach[17, 17], "竖臂尽头要走通(需要列传播)"
    assert not reach[island], "不连通的孤岛绝不能被标记为可达"


def test_spread_matches_bruteforce_bfs_on_random_masks():
    """与逐像素 BFS 逐点等价 —— 向量化只是为了快,不能改语义。"""
    from collections import deque

    import numpy as np

    from windup_framework.providers.matte import _spread

    def bfs(seed, region):
        h, w = region.shape
        out = np.zeros_like(region)
        q = deque()
        for y, x in zip(*np.nonzero(seed & region), strict=True):
            out[y, x] = True
            q.append((y, x))
        while q:
            cy, cx = q.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and region[ny, nx] and not out[ny, nx]:
                    out[ny, nx] = True
                    q.append((ny, nx))
        return out

    rng = np.random.default_rng(7)
    for _ in range(25):
        h, w = int(rng.integers(3, 30)), int(rng.integers(3, 30))
        region = rng.random((h, w)) < rng.uniform(0.3, 0.9)
        seed = rng.random((h, w)) < 0.05
        assert (_spread(seed, region) == bfs(seed, region)).all()


# ── cutout 的装配顺序（不碰真模型）─────────────────────────────────────────
#
# 真实推理需要 4.7MB 的 onnx 权重，CI 里既下不到也不该下。但 cutout 本身的**装配顺序**
# 是有语义的，可以用一个假 session 覆盖：
#   预测 mask → 乘键控清理系数 → 填封闭空洞 → 合成 RGBA
# 顺序错了会静默出错结果：先填洞再清理，会把刚填上的像素又清掉。


class _FakeSession:
    """假 onnxruntime session：返回一个中间为主体的 mask。"""

    class _In:
        name = "input"

    def get_inputs(self):
        return [self._In()]

    def run(self, _out, feed):
        import numpy as np

        t = next(iter(feed.values()))
        h, w = t.shape[2], t.shape[3]
        m = np.zeros((1, 1, h, w), dtype="float32")
        m[:, :, h // 4 : h * 3 // 4, w // 4 : w * 3 // 4] = 1.0
        return [m]


def _provider_with_fake_session(monkeypatch):
    from windup_framework.providers.matte import OnnxU2NetMatteProvider

    p = OnnxU2NetMatteProvider()
    monkeypatch.setattr(p, "_get_session", lambda: _FakeSession())
    return p


def _png(w=64, h=64, color=(220, 220, 220)):
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


def test_cutout_outputs_rgba_png_with_alpha(monkeypatch):
    import io

    from PIL import Image

    out = _provider_with_fake_session(monkeypatch).cutout(_png())
    im = Image.open(io.BytesIO(out))
    assert im.format == "PNG" and im.mode == "RGBA"
    assert im.size == (64, 64)


def test_cutout_keeps_rgb_untouched(monkeypatch):
    """抠图只动 alpha。改 RGB 会让后续像素化锁色板取到被改过的颜色。"""
    import io

    import numpy as np
    from PIL import Image

    src = _png(color=(31, 41, 59))
    out = _provider_with_fake_session(monkeypatch).cutout(src)
    a = np.asarray(Image.open(io.BytesIO(out)))
    b = np.asarray(Image.open(io.BytesIO(src)).convert("RGB"))
    assert np.array_equal(a[:, :, :3], b), "RGB 通道被改了"


def test_cutout_applies_flat_bg_cleanup_before_filling_holes(monkeypatch):
    """顺序：清理 → 填洞。反过来会把刚填上的像素又清掉，且不报错。

    用调用顺序断言而不是像素结果 —— 结果层面两种顺序在简单图上可能相同，
    那样的用例杀不掉顺序颠倒这个变异。
    """
    import windup_framework.providers.matte as M

    order: list[str] = []
    real_pen, real_fill = M._flat_bg_penalty, M._fill_enclosed_holes
    monkeypatch.setattr(M, "_flat_bg_penalty",
                        lambda rgb: (order.append("clean"), real_pen(rgb))[1])
    monkeypatch.setattr(M, "_fill_enclosed_holes",
                        lambda a, rgb: (order.append("fill"), real_fill(a, rgb))[1])
    _provider_with_fake_session(monkeypatch).cutout(_png())
    assert order == ["clean", "fill"], order


# ── 键控清理不得抠穿主体 ────────────────────────────────────────────────────
#
# 固定阈值 38 会杀掉与底色距离小于它的**主体内部**像素:实测五个真实角色母版上,
# 用 u2netp 掩码判主体,受损比例最高到 34.4%(美少女)、10.2%(钟表匠)。深色角色距离
# 300 以上,永远不沾这个窗口 —— 所以症状只出现在浅色角色身上。


def _synth(bg, body, size=96):
    """整幅 bg 底色,中间一块 body 色的主体。"""
    img = np.full((size, size, 3), bg, dtype=np.float32)
    img[28:76, 32:64] = body
    return img


@pytest.mark.parametrize("name,bg,body", [
    ("骨白角色白底", (250, 250, 250), (238, 236, 228)),
    ("浅灰铠甲白底", (248, 248, 248), (226, 226, 224)),
    ("浅肤色灰白底", (235, 235, 232), (241, 214, 196)),
    ("米白布料白底", (250, 250, 250), (232, 228, 215)),
])
def test_light_subject_is_not_keyed_through(name, bg, body):
    """浅色主体不得被键控清理削掉,一个像素都不行。"""
    from windup_framework.providers.matte import _flat_bg_penalty

    core = _flat_bg_penalty(_synth(bg, body))[28:76, 32:64]
    assert (core == 1.0).all(), f"{name}: {int((core < 1.0).sum())} 个主体像素被削"


def test_dark_subject_unaffected():
    """深色主体本来就不受影响,改动不该改变它。"""
    from windup_framework.providers.matte import _flat_bg_penalty

    core = _flat_bg_penalty(_synth((250, 250, 250), (60, 55, 70)))[28:76, 32:64]
    assert (core == 1.0).all()


@pytest.mark.parametrize("noise", [0.0, 3.0])
def test_enclosed_gap_still_cleaned(noise):
    """清理能力不得回退:被主体围住的底色空隙仍要被清掉。

    这是 _flat_bg_penalty 存在的理由 —— u2netp 对闭合区域失灵,四足腿间的背景会被
    当成主体内部整块留下。窄半径不能把这个能力一起窄掉。
    """
    from windup_framework.providers.matte import _flat_bg_penalty

    rng = np.random.default_rng(7)
    img = np.full((96, 96, 3), (250, 250, 250), dtype=np.float32)
    if noise:
        img += rng.normal(0, noise, img.shape)
    img[20:80, 24:72] = (60, 55, 70)                 # 主体
    img[40:60, 40:56] = (250, 250, 250)              # 主体内部的底色空隙
    if noise:
        img[40:60, 40:56] += rng.normal(0, noise, (20, 16, 3))

    gap = _flat_bg_penalty(img)[40:60, 40:56]
    assert (gap == 0.0).mean() > 0.9, "闭合空隙没被清掉,清理能力回退了"


def test_kill_radius_follows_background_noise():
    """半径随底噪走:干净底取下限,噪声底自动放宽。"""
    from windup_framework.providers.matte import _kill_radius, _KEY_KILL_MIN, _KEY_KILL_MAX

    rng = np.random.default_rng(3)
    clean = np.full((96, 96, 3), 250.0, dtype=np.float32)
    noisy = clean + rng.normal(0, 4.0, clean.shape)

    assert _kill_radius(clean) == _KEY_KILL_MIN
    assert _KEY_KILL_MIN < _kill_radius(noisy) <= _KEY_KILL_MAX


# ── 两个模型的 alpha 取并集 ───────────────────────────────────────────────
#
# 两者漏检的位置不重叠:轻量版把浅肤色角色的脸颊与小腿判成背景(测试反馈的"浅色角色被
# 抠穿"),全量版把 T-pose 平举的细手臂整条丢掉。实测 9 张:主体覆盖 14.78% → 15.77%,
# 漏检最严重那张的洞 11.69% → 0.06%。


class _SaliencySession:
    """按给定的显著性图返回 u2net 形状的输出。"""

    def __init__(self, sal):
        self._sal = np.asarray(sal, dtype=np.float32)

    class _In:
        name = "input.1"

    def get_inputs(self):
        return [self._In()]

    def run(self, _outputs, _feed):
        return [self._sal[None, None, :, :]]


def _provider_with(main_sal, refine_sal):
    from windup_framework.providers import matte as M

    prov = M.OnnxU2NetMatteProvider(model_path="/nonexistent.onnx", refine_model_url=None)
    prov._session = _SaliencySession(main_sal)
    prov._refine_session = _SaliencySession(refine_sal) if refine_sal is not None else None
    return prov


def test_the_two_models_cover_each_others_misses():
    """一个模型漏左半、另一个漏右半 —— 并集两边都在。"""
    n = 320
    left = np.zeros((n, n), dtype=np.float32)
    left[:, : n // 2] = 1.0
    right = np.zeros((n, n), dtype=np.float32)
    right[:, n // 2 :] = 1.0
    prov = _provider_with(left, right)

    mask = np.asarray(prov._predict_mask(Image.new("RGB", (n, n), (30, 30, 30))))
    assert mask[:, 10].mean() > 200, "左半被丢了"
    assert mask[:, -10].mean() > 200, "右半被丢了 —— 并集没生效"


def test_a_missing_refine_model_degrades_to_one_model_and_says_so(caplog):
    """补充模型取不到时不该整条失败,但必须留痕。"""
    from windup_framework.providers import matte as M

    prov = M.OnnxU2NetMatteProvider(
        model_path="/nonexistent.onnx",
        refine_model_path="/nonexistent-refine.onnx",
        refine_model_url=None,
    )
    with caplog.at_level("WARNING"):
        assert prov._get_refine_session() is None
    assert any("补充模型" in r.message for r in caplog.records), \
        f"降级没留痕:{[r.message for r in caplog.records]}"
    # 第二次不再重试、也不再刷日志
    n0 = len(caplog.records)
    assert prov._get_refine_session() is None
    assert len(caplog.records) == n0, "每帧都重试了一次取模型"


def test_an_interrupted_download_leaves_no_cache_file(tmp_path, monkeypatch):
    """传输中途断开不能留下不完整文件。

    留了的话之后每次都靠 exists() 判断"已经有了"，网络恢复也不会重下，这台机器就长期
    退回单模型 —— 而单模型正是会把浅肤色角色抠穿的那条路。
    """
    from windup_framework.providers import matte as M

    dest = tmp_path / "sub" / "u2net.onnx"

    class _Half:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self, *_a): raise OSError("connection reset")

    monkeypatch.setattr(M.urllib.request, "urlopen", lambda _u: _Half())
    with pytest.raises(OSError):
        M._download_atomic("https://example.invalid/m.onnx", dest)
    assert not dest.exists(), "残片留在了缓存路径上"
    assert list(dest.parent.glob("*.part")) == [], "临时文件没清掉"


def test_an_unusable_cached_model_is_removed_so_the_next_run_can_redownload(
    tmp_path, monkeypatch, caplog
):
    """已存在但建不起会话的文件要删掉，否则每次都跳过重下、永久降级。"""
    from windup_framework.providers import matte as M

    bad = tmp_path / "u2net.onnx"
    bad.write_bytes(b"not-an-onnx")
    prov = M.OnnxU2NetMatteProvider(
        model_path="/nonexistent.onnx", refine_model_path=bad, refine_model_url=None,
    )
    with caplog.at_level("WARNING"):
        assert prov._get_refine_session() is None
    assert not bad.exists(), "坏文件留在缓存里，下次还会跳过重下"


def test_ort_session_disables_cpu_arena_and_limits_intra_op(monkeypatch, tmp_path):
    """4C8G:关 CPU arena、intra_op=1,否则预分配后 RSS 不回落。"""
    import sys
    import types

    captured: dict = {}

    class _Opt:
        def __init__(self):
            self.enable_cpu_mem_arena = True
            self.intra_op_num_threads = 0

    def _session(path, sess_options=None, providers=None):
        captured["arena"] = sess_options.enable_cpu_mem_arena
        captured["threads"] = sess_options.intra_op_num_threads
        captured["providers"] = providers
        return _FakeSession()

    monkeypatch.setitem(
        sys.modules, "onnxruntime",
        types.SimpleNamespace(SessionOptions=_Opt, InferenceSession=_session),
    )
    model = tmp_path / "u2netp.onnx"
    model.write_bytes(b"x")
    OnnxU2NetMatteProvider(model_path=model, refine_model_url=None)._get_session()
    assert captured["arena"] is False
    assert captured["threads"] == 1
    assert captured["providers"] == ["CPUExecutionProvider"]


def test_refine_env_off_skips_full_u2net(monkeypatch, caplog):
    monkeypatch.setenv("WINDUP_MATTE_REFINE", "0")
    with caplog.at_level("WARNING"):
        p = OnnxU2NetMatteProvider()
    assert p._refine_path is None
    assert any("WINDUP_MATTE_REFINE" in r.message for r in caplog.records)


def test_cutout_serializes_ort_run_across_threads(monkeypatch):
    """POLL>1 时两路 cutout 不得并行 session.run。"""
    import threading
    import time

    running = 0
    max_running = 0
    tally = threading.Lock()

    class _Slow(_FakeSession):
        def run(self, *a, **k):
            nonlocal running, max_running
            with tally:
                running += 1
                max_running = max(max_running, running)
            time.sleep(0.05)
            try:
                return super().run(*a, **k)
            finally:
                with tally:
                    running -= 1

    p = _provider_with_fake_session(monkeypatch)
    monkeypatch.setattr(p, "_get_session", lambda: _Slow())
    monkeypatch.setattr(p, "_get_refine_session", lambda: None)

    def _go():
        p.cutout(_png())

    threads = [threading.Thread(target=_go) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)
    assert max_running == 1, f"ORT Run 叠了 {max_running} 路"
