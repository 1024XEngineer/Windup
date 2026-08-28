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
    """排不上时的错误信息要说清是上游并发限制,不是原样抛上游错误码。"""
    monkeypatch.setattr("time.sleep", lambda _s: None)

    def _busy():
        raise UpstreamBusyError("RequestLimitExceeded.JobNumExceed", "满了")

    with pytest.raises(RuntimeError, match="同时只能跑一个绑骨任务"):
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
