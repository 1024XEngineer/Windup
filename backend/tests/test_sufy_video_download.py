"""视频成品下载的重试与完整性校验(不联网:用 httpx MockTransport)。

回归对象是 2026-08-05 实测两次连续复现的一类失败:视频已生成、费用已产生,
却因为读 body 时断了一次连接就整单丢弃。见 ``providers.sufy._download`` 的 docstring。
"""

import httpx
import pytest

from windup_framework.providers.sufy import IncompleteDownloadError, _download

VIDEO = b"\x00\x01mp4-bytes" * 64


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_retries_after_peer_closed_connection(monkeypatch):
    """第一次断连、第二次成功 —— 原实现在这里会整单丢弃。"""
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.RemoteProtocolError(
                "peer closed connection without sending complete message body", request=request
            )
        return httpx.Response(200, content=VIDEO)

    with _client(handler) as client:
        assert _download(client, "https://example.invalid/v.mp4") == VIDEO
    assert calls["n"] == 2


def test_rejects_truncated_body_that_does_not_raise(monkeypatch):
    """服务端声明的长度与实收不符时必须失败,而不是把坏视频往下游送。

    截断不一定抛异常。放过去的话,坏视频要到出帧环节才暴露成"解码失败",
    很难回溯到下载这一步。
    """
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    def handler(request: httpx.Request) -> httpx.Response:
        # 只回一半 body,但 Content-Length 仍声明全长
        return httpx.Response(
            200, content=VIDEO[: len(VIDEO) // 2], headers={"content-length": str(len(VIDEO))}
        )

    with _client(handler) as client, pytest.raises(RuntimeError, match="已重试 3 次"):
        _download(client, "https://example.invalid/v.mp4")


def test_accepts_chunked_response_without_content_length(monkeypatch):
    """分块传输没有 Content-Length,此时跳过校验而不是误判为不完整。"""
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=httpx.ByteStream(VIDEO))

    with _client(handler) as client:
        assert _download(client, "https://example.invalid/v.mp4") == VIDEO


def test_gives_up_after_three_tries_and_reports_the_last_cause(monkeypatch):
    """一直断连时要显式失败,并把最后一次的真实原因带出来。"""
    monkeypatch.setattr("windup_framework.providers.sufy.time.sleep", lambda _: None)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        raise httpx.ConnectError("connection reset", request=request)

    with _client(handler) as client, pytest.raises(RuntimeError, match="connection reset"):
        _download(client, "https://example.invalid/v.mp4")
    assert calls["n"] == 3


def test_incomplete_download_error_is_a_runtime_error():
    """调用方按 RuntimeError 兜底即可,不必单独 import 这个子类。"""
    assert issubclass(IncompleteDownloadError, RuntimeError)
