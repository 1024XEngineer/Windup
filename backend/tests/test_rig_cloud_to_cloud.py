"""绑骨走云到云,并在撞上游并发上限时退避重试(#860 / #861)。

两条都是 2026-08-28 在生产上真跑三渲二时撞出来的。
"""
from __future__ import annotations

import pytest

from windup_framework.providers.render3d.tencent import (
    UpstreamBusyError,
    _raise_for_error,
    _submit_with_backoff,
)


# ── #861 撞并发上限要能重试 ───────────────────────────────────────────────


def test_the_concurrency_limit_is_a_separate_retryable_error():
    """拦的坏例:``JobNumExceed`` 和"参数错""余额不足"混成一个类型。

    混在一起,调用方就只能一律当永久失败 —— 而它退避几十秒就能过。实测:

        第1次 JobNumExceed（上一个任务此时已 DONE）
        第2次 JobNumExceed
        第3次 JobNumExceed
        等 30 秒后 → 成功
    """
    with pytest.raises(UpstreamBusyError):
        _raise_for_error({"Error": {"Code": "RequestLimitExceeded.JobNumExceed",
                                    "Message": "当前已达到1个任务上限，请稍后重试"}})


def test_other_errors_are_not_swallowed_as_busy():
    """反向:别的错不能被当成"忙"而傻等 —— 那会把一个立刻可知的失败拖成五轮退避。

    **原本这条拿 DownloadError 当例子,2026-08-28 的实测推翻了它** ——
    同一个 18MB URL 报了 DownloadError 之后原样重发就成功(JobId=1484843892775575552),
    而那个 URL 我们自己 HEAD 过:206、18366000 字节、content-type 正确。
    所以它属于上游瞬时故障、可重试(见下面那组用例),不是"立刻可知的失败"。
    这里换成参数错 —— 那才是重试没有意义的那类。
    """
    from windup_framework.providers.render3d.tencent import TencentApiError

    with pytest.raises(TencentApiError) as e:
        _raise_for_error({"Error": {"Code": "InvalidParameterValue",
                                    "Message": "File3D.Url 不合法"}})
    assert not isinstance(e.value, UpstreamBusyError)


def test_a_busy_submit_is_retried_and_eventually_succeeds(monkeypatch):
    """退避重试:前两次忙、第三次成。"""
    monkeypatch.setattr("time.sleep", lambda _s: None)
    calls = []

    def _submit():
        calls.append(1)
        if len(calls) < 3:
            raise UpstreamBusyError("RequestLimitExceeded.JobNumExceed", "满了")
        return "job-42"

    assert _submit_with_backoff(_submit, base=0.01) == "job-42"
    assert len(calls) == 3


def test_only_busy_errors_are_retried(monkeypatch):
    """拦的坏例:什么错都重试 —— 提交成功之后再重试就是**重复扣费**。"""
    monkeypatch.setattr("time.sleep", lambda _s: None)
    calls = []

    def _submit():
        calls.append(1)
        raise ValueError("参数错")

    with pytest.raises(ValueError):
        _submit_with_backoff(_submit, base=0.01)
    assert len(calls) == 1, "非忙错误被重试了,这会重复扣费"


def test_giving_up_says_what_actually_happened(monkeypatch):
    """放弃时的错误信息要带上**上游的真实 code**,而不是预设一个原因。

    原先这条断言的是「说清是上游并发限制」,而那正是 2026-08-28 把我带偏的东西:
    三种可重试故障被写死成同一句「只能跑一个绑骨任务」,于是 RequestTimeout
    也长成了并发问题的样子。判据改成「带上真实 code」。
    """
    monkeypatch.setattr("time.sleep", lambda _s: None)

    def _busy():
        raise UpstreamBusyError("RequestLimitExceeded.JobNumExceed", "满了")

    with pytest.raises(RuntimeError, match="JobNumExceed"):
        _submit_with_backoff(_busy, attempts=2, base=0.01)


# ── #860 云到云 ───────────────────────────────────────────────────────────


def test_cloud_to_cloud_submits_the_url_without_transferring_bytes(monkeypatch):
    """拦的坏例:明明有上游 URL,还是把 18MB 拉下来再传上去。

    每建一个资产原本约 76MB 穿过应用机,而部署机出网上行只有 5.5–5.8 MB/s(#713)。
    """
    from windup_framework.providers.render3d.tencent import TencentAutoRigProvider

    prov = TencentAutoRigProvider.__new__(TencentAutoRigProvider)
    prov._allow_spend = True
    prov._creds = object()
    uploaded = []
    prov._uploader = type("U", (), {"upload": lambda s, *a: uploaded.append(1)})()
    monkeypatch.setattr(prov, "quote", lambda *a, **k: 10)
    monkeypatch.setattr(prov, "resolve_motion", lambda m: type("P", (), {"name": "walk", "motion_type": 23})())
    monkeypatch.setattr(prov, "_submit", lambda u, f, p: "job-1")
    monkeypatch.setattr(prov, "_wait", lambda j: [{"Type": "FBX", "Url": "https://x/y.fbx"}])
    monkeypatch.setattr(
        "windup_framework.providers.render3d.tencent._download",
        lambda u: b"Kaydara FBX Binary  " + b"\0" * 40)
    monkeypatch.setattr(
        "windup_framework.providers.render3d.tencent._verify_magic", lambda d, f: None)

    got = prov.rig_from_url("https://upstream.example.com/model.glb", "GLB", motion="walk")
    assert got.fmt == "FBX"
    assert not uploaded, "云到云那条路居然还上传了 —— 那正是要省掉的一跳"


def test_a_non_public_url_is_refused_before_spending():
    """本地路径 / dataURI 在提交前就炸,不是花完钱才发现上游取不到。"""
    from windup_framework.providers.render3d.tencent import (
        ModelNotPublicError, TencentAutoRigProvider,
    )

    prov = TencentAutoRigProvider.__new__(TencentAutoRigProvider)
    prov._allow_spend = True
    prov._creds = object()
    prov.quote = lambda *a, **k: 10
    prov.resolve_motion = lambda m: type("P", (), {"name": "walk", "motion_type": 23})()

    with pytest.raises(ModelNotPublicError):
        prov.rig_from_url("/tmp/local.glb", "GLB", motion="walk")


def test_the_cloud_to_cloud_path_also_retries_on_busy(monkeypatch):
    """拦的坏例:退避重试只接在中转那条路上,云到云这条漏了。

    两条路提交的是同一个上游接口,并发上限对二者一视同仁。漏接的话,云到云
    (省带宽的那条,也是我们要走的主路)反而更容易在并发时失败。
    """
    from windup_framework.providers.render3d.tencent import (
        TencentAutoRigProvider, UpstreamBusyError,
    )

    monkeypatch.setattr("time.sleep", lambda _s: None)
    prov = TencentAutoRigProvider.__new__(TencentAutoRigProvider)
    prov._allow_spend = True
    prov._creds = object()
    prov._uploader = None
    monkeypatch.setattr(prov, "quote", lambda *a, **k: 10)
    monkeypatch.setattr(prov, "resolve_motion",
                        lambda m: type("P", (), {"name": "walk", "motion_type": 23})())

    tries = []

    def _submit(u, f, p):
        tries.append(1)
        if len(tries) < 3:
            raise UpstreamBusyError("RequestLimitExceeded.JobNumExceed", "满了")
        return "job-9"

    monkeypatch.setattr(prov, "_submit", _submit)
    monkeypatch.setattr(prov, "_wait", lambda j: [{"Type": "FBX", "Url": "https://x/y.fbx"}])
    monkeypatch.setattr(
        "windup_framework.providers.render3d.tencent._download",
        lambda u: b"Kaydara FBX Binary  " + b"\0" * 40)
    monkeypatch.setattr(
        "windup_framework.providers.render3d.tencent._verify_magic", lambda d, f: None)

    got = prov.rig_from_url("https://upstream.example.com/m.glb", "GLB", motion="walk")
    assert got.fmt == "FBX"
    assert len(tries) == 3, f"云到云那条没重试(只提交了 {len(tries)} 次)"


# ── 上游瞬时故障也要重试（#874）─────────────────────────────────────────────
#
# 2026-08-28 一次端到端里三种都撞到过，而每一次都是「原样再发一遍就过」。
# 不重试的代价：它们都发生在图生 3D 已经付过 20 积分之后。


@pytest.mark.parametrize(
    "code,msg",
    [
        ("FailedOperation.ServerError", "算法服务异常"),
        ("FailedOperation.RequestTimeout", "后端服务超时。"),
        ("FailedOperation.DownloadError", "文件下载失败。"),
    ],
)
def test_transient_upstream_failures_are_retryable(code, msg):
    """拦的坏例：把上游的瞬时故障当成永久失败，直接把钱和状态都卡死。

    `DownloadError` 尤其误导 —— 字面看像「我们的 URL 取不到」。实测不是：同一个
    18MB URL 报了 DownloadError 之后原样重发就成功了
    （JobId=1484843892775575552），而那个 URL 我们自己 HEAD 过：
    206、18366000 字节、content-type 正确。
    """
    with pytest.raises(UpstreamBusyError):
        _raise_for_error({"Error": {"Code": code, "Message": msg}})


def test_a_genuinely_bad_url_is_retried_too_and_that_is_the_tradeoff():
    """诚实说明这条判据的边界 —— 它**不区分**两种 DownloadError。

    URL 真的取不到时上游报的也是 `DownloadError`（今天用不存在的 URL 做过控制样本）。
    所以真取不到的场合会被多重试几轮，代价是多等几十秒；而反过来（不重试）的代价是
    一次已付费的资产永久建不成。取舍取在这一侧。

    要真区分，得我们自己先 HEAD 一次那个 URL —— 那是另一件事，没做。
    本条只钉住「现在的行为是重试」，免得将来有人以为它已经区分了。
    """
    with pytest.raises(UpstreamBusyError):
        _raise_for_error({
            "Error": {"Code": "FailedOperation.DownloadError", "Message": "文件下载失败。"}
        })


def test_a_parameter_error_is_still_permanent():
    """反向：参数错这类不该重试 —— 重试五轮只是把一个立刻可知的失败拖长。"""
    from windup_framework.providers.render3d.tencent import TencentApiError

    with pytest.raises(TencentApiError) as e:
        _raise_for_error({"Error": {"Code": "InvalidParameter", "Message": "参数不合法"}})
    assert not isinstance(e.value, UpstreamBusyError)


# ── 退避要接到**实际受影响的流程**上，不只是改异常类型（#874 评审）──────────
#
# `_raise_for_error` 被六处调用：图生 3D 的提交与轮询、绑骨的提交与轮询，以及取
# AppId。只把异常类型改掉、而没有调用方捕获重发的话，用户侧的行为一个字都没变 ——
# 仍然是「已扣 20 积分后立即失败」。


def test_image_to_3d_submit_retries_transient_failures(monkeypatch):
    """拦的坏例：只有绑骨提交接了退避，图生 3D 提交没接。

    图生 3D 提交失败时还没扣钱，但用户会在「点了建资产、什么都没发生」之间反复试，
    而每一次都是原样重发就能过。
    """
    from windup_framework.providers.render3d import tencent as t

    monkeypatch.setattr("time.sleep", lambda _s: None)
    calls = []

    def _fake_call(action, params, **kw):
        calls.append(action)
        if action == "SubmitHunyuanTo3DProJob" and len(calls) < 3:
            return {"Error": {"Code": "FailedOperation.ServerError", "Message": "算法服务异常"}}
        return {"JobId": "job-3d"}

    monkeypatch.setattr(t, "call", _fake_call)
    prov = t.TencentModel3DProvider.__new__(t.TencentModel3DProvider)
    prov._creds = object()
    assert prov._submit({"x": 1}) == "job-3d"
    assert calls.count("SubmitHunyuanTo3DProJob") == 3, (
        f"只提交了 {calls.count('SubmitHunyuanTo3DProJob')} 次 —— 没接退避"
    )


@pytest.mark.parametrize(
    "cls_name,api,attr",
    [
        ("TencentModel3DProvider", "QueryHunyuanTo3DProJob", "ResultFile3Ds"),
        ("TencentAutoRigProvider", "DescribeAutoRiggingJob", "ResultFile3Ds"),
    ],
)
def test_polling_survives_a_transient_failure(monkeypatch, cls_name, api, attr):
    """拦的坏例：轮询撞上游瞬时故障就抛，把一次**已经付过钱**的任务作废。

    任务在云上还在跑、JobId 也还在 —— 抛出去等于钱花了、产物取不回来。
    """
    from windup_framework.providers.render3d import tencent as t

    monkeypatch.setattr("time.sleep", lambda _s: None)
    seen = []

    def _fake_call(action, params, **kw):
        seen.append(action)
        if len(seen) < 3:
            return {"Error": {"Code": "FailedOperation.RequestTimeout", "Message": "后端服务超时。"}}
        return {"Status": "DONE", attr: [{"Type": "FBX", "Url": "https://x/y.fbx"}]}

    monkeypatch.setattr(t, "call", _fake_call)
    prov = getattr(t, cls_name).__new__(getattr(t, cls_name))
    prov._creds = object()
    prov._poll = 1
    prov._max_min = 1
    files = prov._wait("job-1")
    assert files and files[0]["Type"] == "FBX"
    assert len(seen) == 3, f"轮询只调了 {len(seen)} 次 —— 瞬时故障把它打断了"


def test_polling_still_reports_a_real_upstream_failure(monkeypatch):
    """反向：上游明确说 FAIL 时要抛，不能一直等到超时。

    没有这条的话，把「继续等」写成「什么都不管」也能让上面那条绿 ——
    而那会把一次真失败拖满整个轮询预算。
    """
    from windup_framework.providers.render3d import tencent as t

    monkeypatch.setattr("time.sleep", lambda _s: None)
    monkeypatch.setattr(
        t, "call",
        lambda *a, **k: {"Status": "FAIL", "ErrorMessage": "模型不合规"})
    prov = t.TencentAutoRigProvider.__new__(t.TencentAutoRigProvider)
    prov._creds = object()
    prov._poll = 1
    prov._max_min = 1
    with pytest.raises(t.JobFailedError, match="绑骨失败"):
        prov._wait("job-2")


def test_the_backoff_window_covers_the_measured_upstream_hold():
    """拦的坏例：退避窗口比上游实际的占位窗口短，等于没重试。

    2026-08-28 生产实测：连着退了 20/40/60/80 秒共 **200 秒仍然排不上**，
    而占位的那个绑骨任务此时早已 `DONE` —— 上游限的是时间窗，不是「在跑的任务数」。

    首版参数（5 轮 × 20 秒基数 ≈ 5 分钟）是照「单发等约 30 秒即过」定的，那次测量
    没有覆盖连续提交的场合。这条把**实测下限**钉住：总等待必须显著超过 200 秒。
    """
    import inspect

    from windup_framework.providers.render3d.tencent import _submit_with_backoff

    sig = inspect.signature(_submit_with_backoff)
    attempts = sig.parameters["attempts"].default
    base = sig.parameters["base"].default
    total = sum(base * (i + 1) for i in range(attempts - 1))
    assert total >= 600, (
        f"总退避 {total:.0f}s 不够 —— 实测 200s 都排不上，而这一步发生在"
        f"图生 3D 已付 20 积分之后，等不起就是那笔钱白花"
    )


def test_the_retry_log_names_the_real_upstream_code(caplog):
    """拦的坏例：退避日志写死一句「并发已满」，把所有可重试故障说成同一件事。

    2026-08-28 实测：五轮退避的日志全是「上游绑骨并发已满」，而最后一次的真实错误是
    `RequestTimeout`（上游持续超时）—— 完全是另一回事。照着那句日志排查「位子被谁
    占了」，方向从一开始就是错的，而真相就在被丢掉的那个 code 里。

    三种可重试故障的下一步动作并不相同：
      JobNumExceed    等一等（别人在用）
      RequestTimeout  上游在抖，换个时间
      ServerError     上游算法服务异常
    """
    import logging

    from windup_framework.providers.render3d.tencent import (
        UpstreamBusyError, _submit_with_backoff,
    )

    def _busy():
        raise UpstreamBusyError("FailedOperation.RequestTimeout", "后端服务超时。")

    with caplog.at_level(logging.INFO):
        with pytest.raises(RuntimeError) as err:
            _submit_with_backoff(_busy, attempts=2, base=0.01)

    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "RequestTimeout" in logged, f"日志里没有真实 code：{logged}"
    assert "并发已满" not in logged, "又把超时说成了并发已满"
    # 最终错误也不该预设原因
    assert "只能跑一个" not in str(err.value), f"结论里预设了原因：{err.value}"
    assert "RequestTimeout" in str(err.value)
