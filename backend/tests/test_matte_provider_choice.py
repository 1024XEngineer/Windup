"""抠图 provider 的选择开关。

这个开关存在的理由:BiRefNet 单帧峰值 6.85GB,生产 worker 上限 5GiB —— 开错方向的代价
不是"抠图差一点",是把 worker 打 OOM。所以默认值与回落方向都要有用例钉住。
"""
from __future__ import annotations

import io
import time

from PIL import Image

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


# ── 内存闸 ───────────────────────────────────────────────────────────────
#
# 上面几条钉的是"选哪个",这几条钉的是"选了但机器扛不住"。两者的失败长相完全不同:
# 前者拿到的是跑得起来的 provider,后者拿到的是一个会在第一帧推理时被 OOM killer
# 杀掉的进程 —— 而现场只看得到 worker 无声重启、任务卡在 RUNNING。


def _no_cgroup(monkeypatch, host_gib: float | None):
    """把内存探测换成一台指定大小的机器;None = 判不出(非 Linux 开发机)。"""
    from windup_framework.providers import matte_factory as f

    monkeypatch.setattr(
        f, "memory_budget_bytes",
        lambda: None if host_gib is None else int(host_gib * 1024**3),
    )


def test_birefnet_on_the_production_worker_falls_back_instead_of_being_oom_killed(
    monkeypatch, caplog
):
    """拦的坏例:在生产 worker 上把这个变量设成 birefnet。

    5GiB 是线上实测值(``/sys/fs/cgroup/memory.max`` = 5368709120),而 BiRefNet 单帧
    峰值 6.85GB。没有这道闸时,进程一路跑到第一帧推理才被杀,没有任何一行提到内存。
    """
    monkeypatch.setenv(ENV, "birefnet")
    _no_cgroup(monkeypatch, 5.0)
    with caplog.at_level("ERROR"):
        provider = make_matte_provider()
    assert isinstance(provider, OnnxU2NetMatteProvider)
    # 光回落不够 —— 得说清是内存不够,否则运维只会看到"抠图怎么还是旧的"。
    assert any("内存上限" in r.getMessage() for r in caplog.records), caplog.text


def test_a_developer_laptop_still_gets_birefnet(monkeypatch):
    """反方向:16GiB 的本机必须拿得到它。

    闸门只该拦扛不住的机器。把组员本机也一起拦掉,这个 provider 就又变回死代码 ——
    而 #823 存在的全部理由就是让它别是死代码。
    """
    pytest.importorskip("onnxruntime")
    from windup_framework.providers.matte_birefnet import BiRefNetMatteProvider

    monkeypatch.setenv(ENV, "birefnet")
    _no_cgroup(monkeypatch, 16.0)
    assert isinstance(make_matte_provider(), BiRefNetMatteProvider)


def test_an_unmeasurable_machine_is_not_blocked(monkeypatch):
    """判不出内存时放行。

    macOS 上没有 cgroup 也没有 /proc/meminfo。因为量不到就把功能关掉,是拿"我不知道"
    当"不行"用。
    """
    pytest.importorskip("onnxruntime")
    from windup_framework.providers.matte_birefnet import BiRefNetMatteProvider

    monkeypatch.setenv(ENV, "birefnet")
    _no_cgroup(monkeypatch, None)
    assert isinstance(make_matte_provider(), BiRefNetMatteProvider)


def test_the_gate_reads_the_cgroup_limit_not_just_host_memory(monkeypatch, tmp_path):
    """拦的坏例:只读 ``/proc/meminfo`` 就下结论。

    容器里那个文件报的是**宿主**的总量:生产宿主 7.7GiB、worker 容器上限 5GiB。
    只看宿主会得出"7.7 也不够、正好也拦住了"——碰巧对,但换一台 32GiB 宿主 + 5GiB
    容器的机器就会放行,然后被 OOM kill。取两者较小值才是对的。
    """
    from windup_framework.providers import matte_factory as f

    cg = tmp_path / "memory.max"
    cg.write_text("5368709120")          # 容器 5GiB —— 线上实测值
    meminfo = tmp_path / "meminfo"
    meminfo.write_text("MemTotal:       33554432 kB\n")   # 宿主 32GiB
    monkeypatch.setattr(f, "_CGROUP_MAX", (str(cg),))
    monkeypatch.setattr(f.pathlib, "Path", f.pathlib.Path)  # 保持真实实现
    orig = f.pathlib.Path

    def _fake(arg):
        return orig(str(meminfo)) if str(arg) == "/proc/meminfo" else orig(arg)

    monkeypatch.setattr(f.pathlib, "Path", _fake)
    assert f.memory_budget_bytes() == 5368709120, "取的不是较小值"


@pytest.mark.parametrize("sentinel", ["max", "9223372036854771712"])
def test_an_unlimited_cgroup_is_not_read_as_a_tiny_limit(monkeypatch, tmp_path, sentinel):
    """拦的坏例:把"不限"的哨兵值当成真上限。

    cgroup v2 用字面量 ``max``,v1 用一个接近 2^63 的数。前者解析失败会拿到 None
    (碰巧安全),后者会得出一个天文数字的"上限"然后放行 —— 而真正该看的是宿主总量。
    """
    from windup_framework.providers import matte_factory as f

    cg = tmp_path / "memory.max"
    cg.write_text(sentinel)
    assert f._read_int(str(cg)) is None


# ── 并发安全 ─────────────────────────────────────────────────────────────


def test_birefnet_forward_passes_never_overlap(monkeypatch):
    """拦的坏例:并发前向叠内存。

    BiRefNet 单帧峰值 6.85GB,而 worker 的生成并发是 IMAGE=4 / ACTION=2。不串行的话
    四路并发就是四份激活值同时在内存里 —— 而单份就已经超过容器上限。u2net 那边一直
    有这把锁(``matte._RUN_LOCK``),本类此前漏了。

    判据是**实测重叠数**,不是"代码里有没有 Lock 字样":后者在把锁挪错位置时照样绿。
    """
    import threading

    from windup_framework.providers import matte_birefnet as mb

    live = 0
    peak = 0
    guard = threading.Lock()

    class _FakeSession:
        def get_inputs(self):
            return [type("I", (), {"name": "x"})()]

        def run(self, _out, _feed):
            nonlocal live, peak
            with guard:
                live += 1
                peak = max(peak, live)
            time.sleep(0.02)                      # 让并发真的有机会重叠
            with guard:
                live -= 1
            import numpy as np
            return [np.zeros((1, 1, 8, 8), dtype="float32")]

    prov = mb.BiRefNetMatteProvider(union_with_u2net=False)
    monkeypatch.setattr(prov, "_get_session", lambda: _FakeSession())

    img = Image.new("RGB", (16, 16), (120, 120, 120))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png = buf.getvalue()

    threads = [threading.Thread(target=prov.cutout, args=(png,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert peak == 1, f"实测同时有 {peak} 个前向在跑;每个峰值 6.85GB,叠起来必 OOM"


def test_the_union_u2net_is_created_once_under_concurrency(monkeypatch):
    """拦的坏例:并集那一路的惰性初始化是检查后赋值,两个线程各建一份。

    每份自带一套 ONNX 会话。worker 并发 4,这个竞态在生产上够得着。
    """
    import threading

    from windup_framework.providers import matte_birefnet as mb

    made = []

    class _FakeU2Net:
        def __init__(self):
            made.append(1)
            time.sleep(0.01)                      # 放大竞态窗口

        def warmup(self):
            pass

    monkeypatch.setattr(
        "windup_framework.providers.matte.OnnxU2NetMatteProvider", _FakeU2Net
    )
    prov = mb.BiRefNetMatteProvider(union_with_u2net=True)
    threads = [threading.Thread(target=prov._ensure_u2net) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(made) == 1, f"并发下建了 {len(made)} 份 u2net,每份一套 ONNX 会话"


# ── 进程里只能有一份 ─────────────────────────────────────────────────────


def test_every_caller_gets_the_same_single_instance(monkeypatch):
    """拦的坏例:进程里存在第二份 provider。

    每份自带一套 ONNX 会话(u2net 常驻 ~0.53GB,并集模式下 BiRefNet 内部再挂一个
    u2net)。生产 worker 容器上限 5GiB —— 多几份不是"稍微费点内存",是起不来。
    """
    from windup_framework.providers import get_matte_provider, reset_matte_provider

    monkeypatch.delenv(ENV, raising=False)
    reset_matte_provider()
    try:
        a, b, c = get_matte_provider(), get_matte_provider(), get_matte_provider()
        assert a is b is c
    finally:
        reset_matte_provider()


def test_a_failed_warmup_does_not_triple_the_instances(monkeypatch):
    """拦的坏例:``warmup()`` 抛异常 → ``bind_matte`` 不执行 → 三个 executor 各建一份。

    这正是此前唯一性靠运气的那条路径:``bootstrap.worker`` 把 warmup + bind_matte 包在
    同一个 ``except Exception`` 里,warmup 一抛,bind_matte 就到不了,而三个 executor
    各自还有惰性兜底。日志里只有一条"ONNX 预热失败,首个抠图任务会再加载"的 WARNING,
    没有任何一处说"你现在有三份"。
    """
    from windup_framework.providers import get_matte_provider, reset_matte_provider
    from windup_framework.providers import matte_factory as mf

    built = []

    class _Boom:
        def __init__(self):
            built.append(1)

        def warmup(self):
            raise RuntimeError("模型下载失败")

        def cutout(self, frame):
            return frame

    monkeypatch.setattr(mf, "make_matte_provider", lambda *a, **k: _Boom())
    reset_matte_provider()
    try:
        # 模拟 bootstrap:拿一份、预热炸了
        p0 = get_matte_provider()
        with pytest.raises(RuntimeError):
            p0.warmup()
        # 三个 executor 各自走惰性兜底
        got = [get_matte_provider() for _ in range(3)]
        assert all(g is p0 for g in got), "预热失败后又建了新的实例"
        assert len(built) == 1, f"进程里建了 {len(built)} 份 provider"
    finally:
        reset_matte_provider()


def test_concurrent_first_calls_build_exactly_one(monkeypatch):
    """拦的坏例:惰性初始化是检查后赋值,并发下多建几份。

    worker 的生成并发默认 IMAGE=4 / ACTION=2,首个抠图任务并发到达是常态。
    """
    import threading

    from windup_framework.providers import get_matte_provider, reset_matte_provider
    from windup_framework.providers import matte_factory as mf

    built = []

    class _Slow:
        def __init__(self):
            built.append(1)
            time.sleep(0.02)          # 放大竞态窗口

    monkeypatch.setattr(mf, "make_matte_provider", lambda *a, **k: _Slow())
    reset_matte_provider()
    try:
        out = []
        threads = [threading.Thread(target=lambda: out.append(get_matte_provider()))
                   for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert len(built) == 1, f"并发下建了 {len(built)} 份"
        assert len({id(o) for o in out}) == 1, "拿到了不同的实例"
    finally:
        reset_matte_provider()


def test_no_production_call_site_bypasses_the_singleton():
    """拦的坏例:新增一个调用点直接用工厂,唯一性就又只能靠人守规矩。

    实测:此前四个调用点全部直接调工厂,唯一性完全靠 ``bind_matte`` 恰好跑成。
    """
    import pathlib

    app_src = pathlib.Path(__file__).resolve().parents[1] / "packages/app/src"
    offenders = []
    for f in app_src.rglob("*.py"):
        text = f.read_text(encoding="utf-8")
        if "make_matte_provider" in text:
            offenders.append(str(f.relative_to(app_src)))
    assert not offenders, (
        f"这些生产文件绕过了单例、直接用工厂:{offenders};"
        "工厂只给测试和本地脚本用,生产一律走 get_matte_provider()"
    )
