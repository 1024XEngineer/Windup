"""两个计费 provider 的用例 —— **一次真任务都不提交**。

提交路径靠替掉 :func:`windup_framework.providers.render3d.tencent.call`(唯一的出网口)来验形状:
参数怎么组、状态机怎么走、产物怎么挑、错误怎么分类。真提交的钱早花过了,产物在
``characters/oc_v4/`` 躺着,重跑一遍只是重复付钱。
"""
from __future__ import annotations

import pytest

from windup_framework.providers.render3d import (
    ArtifactFormatError,
    InsufficientCreditsError,
    JobFailedError,
    JobTimeoutError,
    ModelNotPublicError,
    ModelRejected,
    PresetMotion,
    RiggedModel,
    SpendNotAuthorizedError,
    TencentAutoRigProvider,
    TencentCredentials,
    TencentModel3DProvider,
    redact,
)
from windup_framework.providers.render3d import tencent as T

from render3d_helpers import make_glb

CREDS = TencentCredentials("AKIDtestonly", "sk-testonly", "ap-guangzhou")
GLB = b"glTF" + b"\x00" * 200
FBX = b"Kaydara FBX Binary  \x00" + b"\x00" * 200


class FakeCloud:
    """替掉 ``tencent.call`` 的假云。``script`` 是 action → 依次返回的响应列表。"""

    def __init__(self, **script: list[dict]) -> None:
        self.script = {k: list(v) for k, v in script.items()}
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, action, params, *, service, version, creds, **kw):
        self.calls.append((action, params))
        queue = self.script.get(action)
        if not queue:
            raise AssertionError(f"假云没有为 {action} 准备响应(已调 {len(self.calls)} 次)")
        return queue.pop(0) if len(queue) > 1 else queue[0]

    def params_for(self, action: str) -> dict:
        return next(p for a, p in self.calls if a == action)

    def count(self, action: str) -> int:
        return sum(1 for a, _ in self.calls if a == action)


class Uploader:
    """记账用的假 uploader。默认返回一个像样的公网 URL。"""

    def __init__(self, url: str = "https://bucket.cos.example.com/abc.glb?sig=x") -> None:
        self.url = url
        self.seen: list[tuple[int, str]] = []

    def upload(self, model: bytes, content_type: str) -> str:
        self.seen.append((len(model), content_type))
        return self.url


@pytest.fixture
def cloud(monkeypatch):
    def install(**script):
        fake = FakeCloud(**script)
        monkeypatch.setattr(T, "call", fake)
        return fake
    return install


@pytest.fixture(autouse=True)
def no_real_download(monkeypatch):
    """产物下载也堵死:任何用例真去 GET 一个 URL 都算测试写漏了。"""
    monkeypatch.setattr(T, "_download", lambda url, **kw: _DOWNLOADS.get(url, GLB))
    yield


_DOWNLOADS: dict[str, bytes] = {}


@pytest.fixture(autouse=True)
def clean_downloads():
    _DOWNLOADS.clear()
    yield
    _DOWNLOADS.clear()


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(T.time, "sleep", lambda s: None)


# ── 花钱这道闸 ──────────────────────────────────────────────────────────────


def test_model3d_refuses_to_spend_by_default(cloud):
    fake = cloud()
    p = TencentModel3DProvider(CREDS)
    with pytest.raises(SpendNotAuthorizedError) as e:
        p.image_to_3d(b"\x89PNG fake")
    assert "20 积分" in str(e.value) and "¥2.4" in str(e.value)   # 报价必须写在异常里
    assert fake.calls == []                                       # 一个请求都没发出去


def test_autorig_refuses_to_spend_by_default(cloud):
    fake = cloud()
    up = Uploader()
    p = TencentAutoRigProvider(up, CREDS)
    with pytest.raises(SpendNotAuthorizedError) as e:
        p.rig(make_glb())
    assert "10 积分" in str(e.value)
    assert fake.calls == [] and up.seen == []      # 也没上传 —— 上传本身要占带宽


def test_precheck_runs_before_the_spend_gate(cloud):
    """超限的档报的是"体积超限"而不是"没授权花钱":一个注定产出错结果的输入,
    连报价都不该走到。"""
    cloud()
    p = TencentAutoRigProvider(Uploader(), CREDS)
    with pytest.raises(ModelRejected):
        p.rig(make_glb(pad=61 * 10**6))


def test_unknown_motion_name_dies_before_the_spend_gate(cloud):
    cloud()
    p = TencentAutoRigProvider(Uploader(), CREDS)
    with pytest.raises(KeyError):
        p.rig(make_glb(), motion="backflip")


def test_quotes_are_pure_computation():
    assert TencentModel3DProvider(CREDS).quote() == (20, 2.4)
    assert TencentModel3DProvider(CREDS, generate_type="Geometry").quote() == (15, 1.8)
    assert TencentModel3DProvider(CREDS, enable_pbr=True).quote() == (30, 3.6)
    assert TencentModel3DProvider(CREDS).quote(n_views=3) == (30, 3.6)
    assert TencentAutoRigProvider(Uploader(), CREDS).quote() == (10, 1.2)


def test_unknown_generate_type_dies_at_construction():
    with pytest.raises(ValueError, match="Normal"):
        TencentModel3DProvider(CREDS, generate_type="UltraPro")


# ── 图生 3D:请求形状 ───────────────────────────────────────────────────────


def test_build_params_shape():
    p = TencentModel3DProvider(CREDS, generate_type="LowPoly", face_count=90000)
    params = p.build_params(b"\x89PNG-master")
    assert params["GenerateType"] == "LowPoly"
    assert params["FaceCount"] == 90000
    assert "EnablePBR" not in params
    import base64
    assert base64.b64decode(params["ImageBase64"]) == b"\x89PNG-master"


def test_multi_view_params_and_view_type_guard():
    p = TencentModel3DProvider(CREDS)
    params = p.build_params(b"front", extra_views={"back": b"b", "right": b"r"})
    assert [v["ViewType"] for v in params["MultiViewImages"]] == ["back", "right"]
    with pytest.raises(ValueError, match="ViewType"):
        p.build_params(b"front", extra_views={"front": b"f"})    # 正面走主参数


def test_oversize_master_is_refused():
    p = TencentModel3DProvider(CREDS)
    with pytest.raises(ValueError, match="ImageBase64"):
        p.build_params(b"x" * (T.MAX_IMAGE_BYTES + 1))


# ── 图生 3D:状态机与产物 ──────────────────────────────────────────────────


def test_model3d_happy_path(cloud):
    fake = cloud(
        SubmitHunyuanTo3DProJob=[{"JobId": "job-1"}],
        QueryHunyuanTo3DProJob=[
            {"Status": "WAIT"}, {"Status": "RUN"},
            {"Status": "DONE", "ResultFile3Ds": [{"Type": "GLB", "Url": "https://x/m.glb"}]},
        ],
    )
    _DOWNLOADS["https://x/m.glb"] = GLB
    out = TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG")
    assert out == GLB
    assert fake.count("QueryHunyuanTo3DProJob") == 3
    # 默认**不发** ResultFormat:没有实测证据说接口收这个参数,而"要哪种格式"已经由取件端
    # (按 Type 挑 + magic 复核)保证。发没验证过的参数只增加被拒风险。
    assert "ResultFormat" not in fake.params_for("SubmitHunyuanTo3DProJob")


def test_result_format_is_opt_in(cloud):
    fake = cloud(SubmitHunyuanTo3DProJob=[{"JobId": "j"}],
                 QueryHunyuanTo3DProJob=[{"Status": "DONE", "ResultFile3Ds": [
                     {"Type": "GLB", "Url": "https://x/m.glb"}]}])
    p = TencentModel3DProvider(CREDS, allow_spend=True, request_result_format=True)
    p.image_to_3d(b"\x89PNG", want="GLB")
    assert fake.params_for("SubmitHunyuanTo3DProJob")["ResultFormat"] == "GLB"


def test_wrong_format_artifact_is_refused_not_returned(cloud):
    """**踩过的坑**:请求 GLB,``ResultFile3Ds[0]`` 是 FBX。当时按 .glb 存了下来,
    Blender 报 "Bad glTF"、出帧台超时,排查方向被带到"出帧管线坏了"。
    bytes 版没有后缀可改,只能抛。"""
    cloud(
        SubmitHunyuanTo3DProJob=[{"JobId": "j"}],
        QueryHunyuanTo3DProJob=[{"Status": "DONE", "ResultFile3Ds": [
            {"Type": "FBX", "Url": "https://x/m.fbx"},
            {"Type": "OBJ", "Url": "https://x/m.zip"},
        ]}],
    )
    with pytest.raises(ArtifactFormatError) as e:
        TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG", want="GLB")
    assert "FBX" in str(e.value) and "OBJ" in str(e.value)


def test_artifact_is_picked_by_type_not_by_position(cloud):
    """要 GLB 而 GLB 排在第二个:必须挑对,不是取 files[0]。"""
    cloud(
        SubmitHunyuanTo3DProJob=[{"JobId": "j"}],
        QueryHunyuanTo3DProJob=[{"Status": "DONE", "ResultFile3Ds": [
            {"Type": "FBX", "Url": "https://x/m.fbx"},
            {"Type": "GLB", "Url": "https://x/m.glb"},
        ]}],
    )
    _DOWNLOADS.update({"https://x/m.fbx": FBX, "https://x/m.glb": GLB})
    assert TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG") == GLB


def test_magic_bytes_override_the_vendors_claim(cloud):
    """产物自称 GLB,内容却是 FBX。``Type`` 是供应商的自述,magic 才是事实 ——
    这一层是上面那个坑的另一半(挑对了标签也可能拿错内容)。"""
    cloud(
        SubmitHunyuanTo3DProJob=[{"JobId": "j"}],
        QueryHunyuanTo3DProJob=[{"Status": "DONE",
                                 "ResultFile3Ds": [{"Type": "GLB", "Url": "https://x/lie.glb"}]}],
    )
    _DOWNLOADS["https://x/lie.glb"] = FBX
    with pytest.raises(ArtifactFormatError, match="自称"):
        TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG")


def test_unknown_status_fails_loudly_with_jobid(cloud):
    """认不出的状态一律当失败,而且必须带 JobId —— 一直 continue 会转到超时,
    把"协议变了"伪装成"生成太慢";带着 JobId 抛出去,任务还能再查。"""
    cloud(SubmitHunyuanTo3DProJob=[{"JobId": "job-x"}],
          QueryHunyuanTo3DProJob=[{"Status": "PAUSED_BY_ALIENS"}])
    with pytest.raises(JobFailedError) as e:
        TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG")
    assert "job-x" in str(e.value) and "PAUSED_BY_ALIENS" in str(e.value)


def test_fail_status_reports_vendor_message(cloud):
    cloud(SubmitHunyuanTo3DProJob=[{"JobId": "j"}],
          QueryHunyuanTo3DProJob=[{"Status": "FAIL", "ErrorMessage": "图里没有主体"}])
    with pytest.raises(JobFailedError, match="图里没有主体"):
        TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG")


def test_timeout_says_credits_may_be_gone(cloud):
    cloud(SubmitHunyuanTo3DProJob=[{"JobId": "j"}], QueryHunyuanTo3DProJob=[{"Status": "RUN"}])
    p = TencentModel3DProvider(CREDS, allow_spend=True, poll_interval=1, max_min=1)
    with pytest.raises(JobTimeoutError, match="积分可能已经扣了"):
        p.image_to_3d(b"\x89PNG")


def test_done_with_no_artifacts_is_a_failure(cloud):
    cloud(SubmitHunyuanTo3DProJob=[{"JobId": "j"}],
          QueryHunyuanTo3DProJob=[{"Status": "DONE", "ResultFile3Ds": []}])
    with pytest.raises(JobFailedError, match="无产物"):
        TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG")


def test_insufficient_credits_is_its_own_error(cloud):
    """积分不足极易被误判成"接口坏了"。修法是充值,不是改代码 —— 所以单独一类。"""
    cloud(SubmitHunyuanTo3DProJob=[
        {"Error": {"Code": "ResourceInsufficient", "Message": "积分余额不足"}}])
    with pytest.raises(InsufficientCreditsError, match="充值"):
        TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG")


def test_bad_want_format_is_refused_before_anything(cloud):
    fake = cloud()
    with pytest.raises(ArtifactFormatError):
        TencentModel3DProvider(CREDS, allow_spend=True).image_to_3d(b"\x89PNG", want="OBJ")
    assert fake.calls == []


# ── 绑骨 ────────────────────────────────────────────────────────────────────


def test_autorig_happy_path_sniffs_input_and_returns_rigged_model(cloud):
    fake = cloud(
        SubmitAutoRiggingJob=[{"JobId": "rig-1"}],
        DescribeAutoRiggingJob=[
            {"Status": "RUN"},
            {"Status": "DONE", "ResultFile3Ds": [{"Type": "GLB", "Url": "https://x/r.glb"}]},
        ],
    )
    _DOWNLOADS["https://x/r.glb"] = GLB
    up = Uploader()
    got = TencentAutoRigProvider(up, CREDS, allow_spend=True).rig(make_glb(), motion="walk")
    assert isinstance(got, RiggedModel)
    assert got.fmt == "GLB" and got.data == GLB
    assert got.motion == PresetMotion("walk", 23)
    sub = fake.params_for("SubmitAutoRiggingJob")
    assert sub["File3D"]["Type"] == "GLB"           # 由 magic 嗅出来,不由调用方声明
    assert sub["MotionType"] == 23
    assert up.seen == [(len(make_glb()), "model/gltf-binary")]


def test_autorig_no_motion_means_no_motiontype_param(cloud):
    fake = cloud(SubmitAutoRiggingJob=[{"JobId": "j"}],
                 DescribeAutoRiggingJob=[{"Status": "DONE", "ResultFile3Ds": [
                     {"Type": "GLB", "Url": "https://x/r.glb"}]}])
    got = TencentAutoRigProvider(Uploader(), CREDS, allow_spend=True).rig(make_glb())
    assert got.motion is None
    assert "MotionType" not in fake.params_for("SubmitAutoRiggingJob")


def test_autorig_wrong_format_artifact_is_refused(cloud):
    """同一个坑在绑骨这一侧的原始形态:请求 GLB 输入,拿回来的 files[0] 是 FBX。"""
    cloud(SubmitAutoRiggingJob=[{"JobId": "j"}],
          DescribeAutoRiggingJob=[{"Status": "DONE", "ResultFile3Ds": [
              {"Type": "FBX", "Url": "https://x/r.fbx"}]}])
    with pytest.raises(ArtifactFormatError, match="FBX"):
        TencentAutoRigProvider(Uploader(), CREDS, allow_spend=True).rig(make_glb(), want="GLB")


def test_autorig_can_ask_for_fbx(cloud):
    cloud(SubmitAutoRiggingJob=[{"JobId": "j"}],
          DescribeAutoRiggingJob=[{"Status": "DONE", "ResultFile3Ds": [
              {"Type": "GLB", "Url": "https://x/r.glb"},
              {"Type": "FBX", "Url": "https://x/r.fbx"}]}])
    _DOWNLOADS.update({"https://x/r.glb": GLB, "https://x/r.fbx": FBX})
    got = TencentAutoRigProvider(Uploader(), CREDS, allow_spend=True).rig(make_glb(), want="FBX")
    assert got.fmt == "FBX" and got.data == FBX


def test_non_public_uploader_url_is_refused_before_submit(cloud):
    fake = cloud()
    up = Uploader(url="/tmp/local/model.glb")
    with pytest.raises(ModelNotPublicError, match="http"):
        TencentAutoRigProvider(up, CREDS, allow_spend=True).rig(make_glb())
    assert fake.calls == []                         # 没提交 = 没占配额


def test_error_text_does_not_leak_the_signature(cloud):
    """预签名 URL 里 ``q-ak`` **就是 SecretId**。任何回显 URL 的地方都必须先脱敏,
    否则一条错误日志等于把半副凭证写进了日志文件。"""
    cloud()
    leaky = "ftp://b.cos/x.glb?q-ak=AKIDrealsecret&q-signature=deadbeefcafe"
    with pytest.raises(ModelNotPublicError) as e:
        TencentAutoRigProvider(Uploader(url=leaky), CREDS, allow_spend=True).rig(make_glb())
    assert "AKIDrealsecret" not in str(e.value)
    assert "deadbeefcafe" not in str(e.value)


def test_redact_keeps_shape_drops_values():
    out = redact("https://h/k?q-sign-algorithm=sha1&q-ak=AKIDxyz&q-signature=abc123&t=1")
    assert "AKIDxyz" not in out and "abc123" not in out
    assert "q-ak=<redacted>" in out and "q-sign-algorithm=sha1" in out and "t=1" in out


def test_credentials_never_render_in_repr():
    """provider 出错时的 traceback 常带上构造参数 —— dataclass 默认 repr 会把 key 打出来。"""
    text = repr(TencentCredentials("AKIDsecret", "keysecret"))
    assert "AKIDsecret" not in text and "keysecret" not in text


# ── 预设动作 ────────────────────────────────────────────────────────────────


def test_preset_motions_all_declare_no_root_motion():
    """48 个预设**全部零根位移**(跑步、向前大跳实测都是 0)。所以 root_motion 只能由
    管线算或人工设 —— 这条事实写进类型里,别指望接口给。"""
    presets = TencentAutoRigProvider(Uploader(), CREDS).preset_motions
    assert presets and all(not m.has_root_motion for m in presets.values())
    assert presets["walk"].motion_type == 23


def test_motion_resolution_by_name_and_number():
    p = TencentAutoRigProvider(Uploader(), CREDS)
    assert p.resolve_motion("run") == PresetMotion("run", 34)
    assert p.resolve_motion(26) == PresetMotion("idle", 26)     # 认得的编号回填名字
    assert p.resolve_motion(7) == PresetMotion("motion_7", 7)   # 没登记名字的照样能用
    assert p.resolve_motion(None) is None


def test_motion_number_out_of_range_is_refused():
    p = TencentAutoRigProvider(Uploader(), CREDS)
    for bad in (0, 49, -1):
        with pytest.raises(ValueError, match="1–48"):
            p.resolve_motion(bad)


def test_unknown_motion_name_lists_what_exists():
    p = TencentAutoRigProvider(Uploader(), CREDS)
    with pytest.raises(KeyError) as e:
        p.resolve_motion("moonwalk")
    assert "walk" in str(e.value) and "48" in str(e.value)


# ── uploader ────────────────────────────────────────────────────────────────


def test_cos_uploader_key_is_content_addressed(monkeypatch):
    """key 用内容哈希:同一份模型重传不堆副本,重试天然幂等。"""
    import hashlib

    up = T.TencentCosModelUploader(CREDS)
    monkeypatch.setattr(up, "appid", lambda: "1300000000")
    seen: list[tuple[str, str]] = []
    monkeypatch.setattr(T, "cos_request",
                        lambda creds, method, uri, host, data=None, timeout=300:
                        (seen.append((method, uri)), (200, ""))[1])
    url = up.upload(GLB, "model/gltf-binary")
    digest = hashlib.sha256(GLB).hexdigest()[:32]
    assert seen == [("PUT", "/"), ("PUT", f"/{digest}.glb")]
    assert url.startswith(f"https://windup-rig-1300000000.cos.ap-guangzhou.myqcloud.com/{digest}.glb?")
    assert "q-signature=" in url


def test_cos_uploader_surfaces_upload_failure(monkeypatch):
    up = T.TencentCosModelUploader(CREDS)
    monkeypatch.setattr(up, "appid", lambda: "1300000000")
    monkeypatch.setattr(T, "cos_request",
                        lambda creds, method, uri, host, data=None, timeout=300:
                        (200, "") if uri == "/" else (403, "AccessDenied"))
    with pytest.raises(JobFailedError, match="403"):
        up.upload(GLB, "model/gltf-binary")
