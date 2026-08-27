"""抠图 provider 的选择开关。

这个开关存在的理由:BiRefNet 单帧峰值 6.85GB,生产 worker 上限 5GiB —— 开错方向的代价
不是"抠图差一点",是把 worker 打 OOM。所以默认值与回落方向都要有用例钉住。
"""
from __future__ import annotations

import pytest

from windup_framework.providers import make_matte_provider
from windup_framework.providers.matte import OnnxU2NetMatteProvider
from windup_framework.providers.matte_factory import ENV


def test_default_is_u2net_so_a_missing_env_cannot_oom_the_worker(monkeypatch):
    """拦的坏例:默认值给成 BiRefNet。

    忘配就该拿到跑得起来的那个。反过来的话,一台没设这个变量的机器会在第一帧抠图时
    被 OOM kill,而表现是 worker 无声重启、任务卡在 RUNNING。
    """
    monkeypatch.delenv(ENV, raising=False)
    assert isinstance(make_matte_provider(), OnnxU2NetMatteProvider)


def test_an_unknown_value_falls_back_instead_of_killing_the_worker(monkeypatch):
    """拦的坏例:不认识的值直接抛错。

    一个拼错的环境变量(``bierfnet``)会让整个 worker 起不来,而回落只是抠图差一点。
    两个方向的代价不对称。
    """
    monkeypatch.setenv(ENV, "bierfnet")
    assert isinstance(make_matte_provider(), OnnxU2NetMatteProvider)


def test_explicit_argument_beats_the_environment(monkeypatch):
    """显式传参优先于环境变量 —— 否则测试与本地脚本没法覆盖部署的设置。"""
    monkeypatch.setenv(ENV, "birefnet")
    assert isinstance(make_matte_provider("u2net"), OnnxU2NetMatteProvider)


def test_birefnet_is_reachable_by_name_not_dead_code(monkeypatch):
    """拦的坏例:provider 合进仓里却没有任何路径能选到它(#686 就是这么变成死代码的)。

    只断言"造出来的是那个类",不真跑推理:权重 224MB,CI 上不该下载,而这条要证明的是
    **接线通了**,不是模型好不好。
    """
    pytest.importorskip("onnxruntime")
    from windup_framework.providers.matte_birefnet import BiRefNetMatteProvider

    monkeypatch.setenv(ENV, "birefnet")
    assert isinstance(make_matte_provider(), BiRefNetMatteProvider)


def test_every_selectable_provider_survives_the_bootstrap_warmup_call(monkeypatch):
    """拦的坏例:某个 provider 缺 ``warmup``,整条共享接线静默失效。

    ``bootstrap.worker`` 是 ``matte.warmup()`` 然后 ``bind_matte(matte)``,两句包在同一个
    ``except Exception`` 里。缺 ``warmup`` 时第一句抛 AttributeError,``bind_matte``
    **就到不了** —— 三个 executor 各自惰性 new 一份,而 BiRefNet 默认与 u2net 取并集,
    每份内部再 new 一个 u2net,进程里 6 个 ONNX 会话。生产 worker 上限 5GiB,
    BiRefNet 单帧峰值 6.85GB。表面上只有一条 "ONNX 预热失败" 的 WARNING。
    (FennoAI 式审查在 #823 上指出;本用例把它钉住。)

    断言的是**协议齐全**,不真跑推理:权重 224MB + 176MB,CI 上不该下载。
    """
    from windup_framework.providers import make_matte_provider
    from windup_framework.providers.matte_factory import ENV, _BIREFNET, _U2NET

    for choice in (_U2NET, _BIREFNET):
        monkeypatch.setenv(ENV, choice)
        provider = make_matte_provider()
        assert callable(getattr(provider, "warmup", None)), (
            f"{type(provider).__name__} 缺 warmup —— bind_matte 会被跳过,"
            "共享实例失效,进程里会装多份 ONNX 会话"
        )
        assert callable(getattr(provider, "cutout", None))
