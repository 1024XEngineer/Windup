"""OnnxU2NetMatteProvider 契约测试(不加载模型 / 不联网:构造 + 协议合规)。"""

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
