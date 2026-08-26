"""任务失败原因不得把内部信息带到用户界面。

样本取自线上 `windup_generation_task.error_message` 的真实值(2026-08-20):对象存储
域名、上游网关地址与端点、内网探测地址、request_id 都曾原样显示给用户。
"""

import httpx
import pytest

from windup_ai_engine.ports import PromptRejectCode, PromptRejected
from windup_app.server.orchestrator._failure import user_message
from windup_app.server.orchestrator._fetch import FetchNotAllowed

# 这些一旦出现在用户可见文案里就是泄露。
FORBIDDEN = (
    "windup.xin", "qnaigc", "/media/upload", "/v1/", "127.0.0.1", "169.254.169.254",
    "WINDUP_", "request_id", "Traceback", "httpx",
)

LIVE_SAMPLES = [
    FetchNotAllowed(
        "只允许拉自家对象存储（https://media.windup.xin）上的素材，"
        "收到 'http://169.254.169.254/latest/meta-data/'。外部图片请先经 POST /media/upload 传入。"
    ),
    httpx.ConnectError("Server error '525 SSL Handshake Failed with Origin Server' "
                       "for url 'https://api.qnaigc.com/v1/chat/completions'"),
    RuntimeError("i2v 失败: failed — {'code': '0', 'message': 'Failure to pass the risk control system'}"),
    ValueError("母版不可用(no_subject):1×1 的图里找不到主体(全透明或全同色)"),
    ValueError("缺少母版:reference_image_urls 为空"),
    RuntimeError("Server disconnected without sending a response.; request_id=img-22"),
    RuntimeError("未登记型号: gemini-3.0-pro-image-preview; request_id=img-7"),
]


@pytest.mark.parametrize("exc", LIVE_SAMPLES, ids=lambda e: type(e).__name__)
def test_no_internal_detail_reaches_the_user(exc):
    msg = user_message(exc)
    leaked = [k for k in FORBIDDEN if k in msg]
    assert not leaked, f"{leaked} 出现在用户可见文案里: {msg}"
    assert msg.strip(), "不能返回空文案 —— 用户会看到一片空白"


def test_user_fixable_input_error_still_says_what_to_fix():
    """脱敏不能脱成"出错了"三个字:用户自己能改的那类必须说清改什么。"""
    msg = user_message(PromptRejected(next(iter(PromptRejectCode)), "描述里不要写否定词"))
    assert "否定词" in msg


def test_unknown_exception_falls_back_instead_of_leaking():
    msg = user_message(RuntimeError("postgresql://root:hunter2@10.0.0.5:5432/windup"))
    assert "hunter2" not in msg and "10.0.0.5" not in msg


def test_download_failures_are_generic_too():
    """产物下载失败也来自上游链路,同样不该带出地址。"""
    from windup_framework.providers.sufy import IncompleteDownloadError, UnsafeDownloadUrlError

    for exc in (IncompleteDownloadError("只下到 12 字节, Content-Length 说 900000"),
                UnsafeDownloadUrlError("成品 URL 协议不是 http(s): file:///etc/passwd")):
        msg = user_message(exc)
        assert "下载失败" in msg
        assert "/etc/passwd" not in msg and "Content-Length" not in msg
