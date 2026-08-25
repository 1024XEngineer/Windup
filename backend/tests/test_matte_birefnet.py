"""BiRefNet 抠图 provider。

不下真模型:214MB 的下载与 5 秒一帧的前向都不该进单测。桩掉会话,验的是本 provider
自己那几处判断 —— 取哪个输出、要不要补 sigmoid、有没有复用键控清理。
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image
from windup_framework.providers.matte_birefnet import BiRefNetMatteProvider


def _png(w=64, h=96, bg=(233, 233, 233), fg=(60, 60, 70)) -> bytes:
    im = Image.new("RGB", (w, h), bg)
    im.paste(fg, (16, 12, 48, 84))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


class _FakeSession:
    """按需给出多尺度输出与不同值域,用来钉住 provider 的解析。"""

    def __init__(self, maps: list[np.ndarray]) -> None:
        self.maps = maps
        self.seen: list[tuple] = []

    def get_inputs(self):
        class _I:
            name = "input_image"
            type = "tensor(float)"
        return [_I()]

    def run(self, _out, feed):
        self.seen.append(feed["input_image"].shape)
        return list(self.maps)


def _bind(monkeypatch, maps):
    s = _FakeSession(maps)
    p = BiRefNetMatteProvider(model_path="/nonexistent-should-not-be-touched.onnx")
    monkeypatch.setattr(p, "_get_session", lambda: s)
    return p, s


def _logit(x):
    x = np.clip(x, 1e-6, 1 - 1e-6)
    return np.log(x / (1 - x))


def test_takes_the_last_output_not_the_first(monkeypatch):
    """多尺度监督的导出给一串输出,最后一个才是最高分辨率。

    取 [0] 会拿到 1/32 尺度的粗图,放大回来是一团模糊 —— 而且它照样是合法 PNG,
    不会报错,只会让下游拿到一张糊掉的掩膜。
    """
    # 两张图形状不同:粗的把左半判成主体,细的把右半判成主体。前景放在右半,
    # 所以「右半不透明」只有取到细的那张才成立。
    coarse = np.zeros((1, 1, 1024, 1024), np.float32)
    coarse[..., :512] = 1.0
    fine = np.zeros((1, 1, 1024, 1024), np.float32)
    fine[..., 512:] = 1.0
    p, _ = _bind(monkeypatch, [coarse, fine])
    # 前景挪到右半,避免与键控清理的判断纠缠
    im = Image.new("RGB", (64, 96), (233, 233, 233))
    im.paste((60, 60, 70), (36, 12, 60, 84))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    out = np.asarray(Image.open(io.BytesIO(p.cutout(buf.getvalue()))).convert("RGBA"))
    left = (out[:, :32, 3] > 128).sum()
    right = (out[:, 32:, 3] > 128).sum()
    assert right > left, f"取到了粗尺度那张(左 {left} 右 {right})"


def test_applies_sigmoid_only_when_output_is_not_already_probabilities(monkeypatch):
    """导出带不带 sigmoid 都要能用。带了就别再压一次 —— 二次 sigmoid 会把
    0/1 压成 0.27/0.73,alpha 全部落进半透明区。"""
    prob = np.zeros((1, 1, 1024, 1024), np.float32)
    prob[..., 200:800, 200:800] = 1.0
    p1, _ = _bind(monkeypatch, [prob])
    a1 = np.asarray(Image.open(io.BytesIO(p1.cutout(_png()))).convert("RGBA"))[:, :, 3]

    p2, _ = _bind(monkeypatch, [_logit(prob).astype(np.float32)])
    a2 = np.asarray(Image.open(io.BytesIO(p2.cutout(_png()))).convert("RGBA"))[:, :, 3]
    assert a1.max() > 250 and a2.max() > 250, "概率与 logit 两种输出都该给出实心 alpha"
    assert abs(int(a1.max()) - int(a2.max())) <= 2


def test_feeds_the_fixed_1024_input_the_export_requires(monkeypatch):
    """导出图里写死 [1,3,1024,1024];喂别的尺寸会以 InvalidArgument 失败。"""
    p, s = _bind(monkeypatch, [np.ones((1, 1, 1024, 1024), np.float32)])
    p.cutout(_png(w=37, h=211))
    assert s.seen == [(1, 3, 1024, 1024)]


def test_output_is_rgba_png_at_the_input_size(monkeypatch):
    p, _ = _bind(monkeypatch, [np.ones((1, 1, 1024, 1024), np.float32)])
    out = p.cutout(_png(w=71, h=93))
    assert out[:8] == b"\x89PNG\r\n\x1a\n"
    im = Image.open(io.BytesIO(out))
    assert im.mode == "RGBA" and im.size == (71, 93)


def test_flat_background_is_cleaned_away(monkeypatch):
    """键控清理必须仍在链上。模型把整幅都判成主体时,纯色底该被减掉 ——
    这一步与用哪个显著性模型无关,复用 matte 的实现而不是抄一份。"""
    p, _ = _bind(monkeypatch, [np.ones((1, 1, 1024, 1024), np.float32)])
    out = np.asarray(Image.open(io.BytesIO(p.cutout(_png()))).convert("RGBA"))
    corner = out[0, 0]
    assert corner[3] < 40, f"四角的纯色底没有被清掉:alpha={corner[3]}"


def test_does_not_touch_the_model_file_when_session_is_injected(monkeypatch):
    """会话已注入时不该去碰模型路径 —— 否则单测会试着下 214MB。"""
    p, _ = _bind(monkeypatch, [np.ones((1, 1, 1024, 1024), np.float32)])
    p.cutout(_png())          # 路径是 /nonexistent,真去下载会抛


def test_missing_model_downloads_to_the_cache_path(monkeypatch, tmp_path):
    """反过来:没注入会话时要真的走下载,且落到给定路径。"""
    called = {}

    def fake_dl(url, dest):
        called["url"] = url
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"not-a-real-onnx")

    monkeypatch.setattr("windup_framework.providers.matte_birefnet._download_atomic", fake_dl)
    target = tmp_path / "sub" / "m.onnx"
    p = BiRefNetMatteProvider(model_path=target)
    assert p._ensure_model() == target and target.exists()
    assert "BiRefNet" in called["url"]


def test_union_with_u2net_is_on_by_default(monkeypatch):
    """BiRefNet 单用会沿整条轮廓切掉角色的深色描边(实测丢主体 1,845 px 对 u2net 的 228)。
    像素画的黑边是主体的一部分,不是抗锯齿,所以默认取两者并集。"""
    called = {}

    class _U2:
        def cutout(self, frame):
            called["hit"] = True
            im = Image.open(io.BytesIO(frame)).convert("RGB")
            a = np.zeros(im.size[::-1] + (4,), np.uint8)
            a[..., :3] = np.asarray(im)
            a[..., 3] = 255                      # u2net 说整幅都是主体
            buf = io.BytesIO()
            Image.fromarray(a, "RGBA").save(buf, "PNG")
            return buf.getvalue()

    # BiRefNet 全判背景;并集后应由 u2net 那份救回来
    p, _ = _bind(monkeypatch, [np.zeros((1, 1, 1024, 1024), np.float32)])
    p._u2net = _U2()
    out = np.asarray(Image.open(io.BytesIO(p.cutout(_png()))).convert("RGBA"))
    assert called.get("hit"), "默认没有走并集"
    assert (out[:, :, 3] > 128).any(), "并集没有把 u2net 的主体救回来"


def test_exported_from_the_providers_public_api():
    """装配代码走 `from windup_framework.providers import ...`;只在子模块里定义等于
    调用方拿不到它,只能绕过公共 API 引内部路径。"""
    import windup_framework.providers as pv

    assert pv.BiRefNetMatteProvider is BiRefNetMatteProvider
    assert "BiRefNetMatteProvider" in pv.__all__


def test_union_can_be_turned_off_for_single_model_evaluation(monkeypatch):
    called = {}

    class _U2:
        def cutout(self, frame):
            called["hit"] = True
            return frame

    p, _ = _bind(monkeypatch, [np.ones((1, 1, 1024, 1024), np.float32)])
    p._union = False
    p._u2net = _U2()
    p.cutout(_png())
    assert "hit" not in called, "关掉之后仍然调了 u2net"
