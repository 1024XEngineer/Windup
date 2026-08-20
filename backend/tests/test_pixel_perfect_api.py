"""独立完美像素工具的 API 与编排契约。"""

import asyncio
from io import BytesIO
import json
import signal
import struct
import sys
import zlib
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

from PIL import Image
from windup_common.enums.biz_code import BizCode

from windup_app.server.pixel_perfect import (
    GridDetection,
    NativeGridDetector,
    NativeGridReconstructor,
    PixelPerfectInputError,
    PixelPerfectBusyError,
    PixelPerfectTool,
    PixelPerfectUnavailableError,
)
from windup_app.web.middleware.pixel_perfect_limits import (
    PixelPerfectRequestLimitsMiddleware,
)


def _png_bytes(width: int = 8, height: int = 8) -> bytes:
    image = Image.new("RGBA", (width, height), (180, 90, 40, 255))
    output = BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def _oversized_png_header(width: int, height: int) -> bytes:
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    chunk = b"IHDR" + ihdr
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", len(ihdr))
        + chunk
        + struct.pack(">I", zlib.crc32(chunk))
    )


class _RecordingTool:
    def __init__(self) -> None:
        self.calls: list[tuple[bytes, int, float | None]] = []

    def process(self, source: bytes, *, colors: int, pixel_size: float | None):
        self.calls.append((source, colors, pixel_size))
        return SimpleNamespace(
            png=_png_bytes(2, 2),
            cols=2,
            rows=2,
            step_x=4.0,
            step_y=4.0,
            consensus="forced",
            confidence="forced",
        )


def test_pixel_perfect_file_endpoint_returns_png_without_business_storage(auth_client):
    tool = _RecordingTool()
    auth_client.app.state.pixel_perfect_tool = tool
    source = _png_bytes()

    response = auth_client.post(
        "/tools/pixel-perfect",
        files={"file": ("source.png", source, "image/png")},
        data={"colors": "16", "pixel_size": "4"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-pixel-cols"] == "2"
    assert response.headers["x-pixel-rows"] == "2"
    assert response.headers["x-pixel-consensus"] == "forced"
    assert response.content == _png_bytes(2, 2)
    assert tool.calls == [(source, 16, 4.0)]


def test_pixel_perfect_endpoint_rejects_unsupported_or_mislabeled_files(auth_client):
    tool = _RecordingTool()
    auth_client.app.state.pixel_perfect_tool = tool

    unsupported = auth_client.post(
        "/tools/pixel-perfect",
        files={"file": ("source.webp", b"RIFFxxxxWEBP", "image/webp")},
    )
    mislabeled = auth_client.post(
        "/tools/pixel-perfect",
        files={"file": ("source.png", b"not-a-png", "image/png")},
    )

    assert unsupported.json()["code"] == BizCode.BAD_REQUEST
    assert mislabeled.json()["code"] == BizCode.BAD_REQUEST
    assert tool.calls == []


def test_pixel_perfect_endpoint_bounds_the_uploaded_bytes(auth_client):
    tool = _RecordingTool()
    auth_client.app.state.pixel_perfect_tool = tool

    response = auth_client.post(
        "/tools/pixel-perfect",
        files={
            "file": (
                "source.png",
                b"\x89PNG\r\n\x1a\n" + bytes(10 * 1024 * 1024),
                "image/png",
            )
        },
    )

    assert response.json()["code"] == BizCode.BAD_REQUEST
    assert tool.calls == []


def test_pixel_perfect_metadata_headers_are_visible_to_the_browser(auth_client):
    auth_client.app.state.pixel_perfect_tool = _RecordingTool()

    response = auth_client.post(
        "/tools/pixel-perfect",
        headers={"origin": "http://127.0.0.1:5173"},
        files={"file": ("source.png", _png_bytes(), "image/png")},
    )

    exposed = {
        name.strip().lower()
        for name in response.headers["access-control-expose-headers"].split(",")
    }
    assert {
        "x-pixel-cols",
        "x-pixel-rows",
        "x-pixel-step-x",
        "x-pixel-step-y",
        "x-pixel-consensus",
        "x-pixel-confidence",
    } <= exposed


class _GridDetector:
    def __init__(self, result: GridDetection) -> None:
        self.result = result
        self.calls: list[bytes] = []

    def detect(self, source: bytes) -> GridDetection:
        self.calls.append(source)
        return self.result


class _GridReconstructor:
    def __init__(self) -> None:
        self.calls: list[tuple[bytes, int, int, int]] = []

    def reconstruct(self, source: bytes, *, cols: int, rows: int, colors: int) -> bytes:
        self.calls.append((source, cols, rows, colors))
        return _png_bytes(cols, rows)


def _detected_grid(*, step_x: float = 4.0, step_y: float = 4.0) -> GridDetection:
    return GridDetection(
        cols=8,
        rows=6,
        step_x=step_x,
        step_y=step_y,
        consensus="arbitrated",
        confidence="medium",
    )


def test_tool_auto_mode_passes_only_the_detected_grid_to_reconstruction():
    source = _png_bytes(32, 24)
    detector = _GridDetector(_detected_grid())
    reconstructor = _GridReconstructor()
    tool = PixelPerfectTool(detector=detector, reconstructor=reconstructor)

    result = tool.process(source, colors=32, pixel_size=None)

    assert detector.calls == [source]
    assert reconstructor.calls == [(source, 8, 6, 32)]
    assert (result.cols, result.rows) == (8, 6)
    assert result.consensus == "arbitrated"


def test_tool_manual_pixel_size_bypasses_detection():
    source = _png_bytes(32, 24)
    detector = _GridDetector(_detected_grid())
    reconstructor = _GridReconstructor()
    tool = PixelPerfectTool(detector=detector, reconstructor=reconstructor)

    result = tool.process(source, colors=16, pixel_size=4)

    assert detector.calls == []
    assert reconstructor.calls == [(source, 8, 6, 16)]
    assert (result.step_x, result.step_y) == (4.0, 4.0)
    assert (result.consensus, result.confidence) == ("forced", "forced")


def test_tool_does_not_auto_process_a_sub_three_pixel_detection():
    detector = _GridDetector(_detected_grid(step_x=2.8))
    reconstructor = _GridReconstructor()
    tool = PixelPerfectTool(detector=detector, reconstructor=reconstructor)

    try:
        tool.process(_png_bytes(32, 24), colors=32, pixel_size=None)
    except PixelPerfectInputError as error:
        assert "小于 3px" in str(error)
    else:
        raise AssertionError("sub-three-pixel auto mode must be rejected")

    assert reconstructor.calls == []


def test_tool_rejects_non_finite_manual_pixel_size():
    tool = PixelPerfectTool(
        detector=_GridDetector(_detected_grid()),
        reconstructor=_GridReconstructor(),
    )

    for value in (float("inf"), float("-inf"), float("nan")):
        try:
            tool.process(_png_bytes(32, 24), colors=32, pixel_size=value)
        except PixelPerfectInputError:
            pass
        else:
            raise AssertionError("manual pixel_size must be finite")


def test_tool_maps_decompression_bombs_to_input_errors():
    tool = PixelPerfectTool(
        detector=_GridDetector(_detected_grid()),
        reconstructor=_GridReconstructor(),
    )

    try:
        tool.process(
            _oversized_png_header(100_000, 100_000),
            colors=32,
            pixel_size=None,
        )
    except PixelPerfectInputError:
        pass
    else:
        raise AssertionError("decompression bomb must be rejected")


def test_tool_validates_the_complete_reconstruction_png_and_grid_size():
    class InvalidReconstructor:
        def __init__(self, output: bytes) -> None:
            self.output = output

        def reconstruct(self, source, *, cols, rows, colors):
            return self.output

    for output in (b"\x89PNG\r\n\x1a\nnot-a-png", _png_bytes(2, 2)):
        tool = PixelPerfectTool(
            detector=_GridDetector(_detected_grid()),
            reconstructor=InvalidReconstructor(output),
        )
        try:
            tool.process(_png_bytes(32, 24), colors=32, pixel_size=None)
        except PixelPerfectUnavailableError:
            pass
        else:
            raise AssertionError("invalid reconstruction must be rejected")


def test_native_detector_reads_stdin_and_parses_the_six_field_contract():
    payload = {
        "cols": 8,
        "rows": 6,
        "step_x": 4.0,
        "step_y": 4.0,
        "consensus": "arbitrated",
        "confidence": "medium",
    }
    code = (
        "import json,sys; sys.stdin.buffer.read(); "
        f"print(json.dumps({json.dumps(payload)}))"
    )
    detector = NativeGridDetector((sys.executable, "-c", code), timeout_seconds=1)

    result = detector.detect(_png_bytes(32, 24))

    assert result == GridDetection(**payload)


def test_native_reconstructor_passes_only_explicit_grid_arguments():
    output = _png_bytes(8, 6)
    code = (
        "import sys; data=sys.stdin.buffer.read(); "
        "expected=['--cols','8','--rows','6','--colors','16']; "
        "sys.exit(2) if sys.argv[1:] != expected else sys.stdout.buffer.write(data)"
    )
    reconstructor = NativeGridReconstructor(
        (sys.executable, "-c", code), timeout_seconds=1
    )

    result = reconstructor.reconstruct(output, cols=8, rows=6, colors=16)

    assert result == output


def test_native_process_timeout_is_reported_as_tool_unavailable():
    detector = NativeGridDetector(
        (sys.executable, "-c", "import time; time.sleep(1)"),
        timeout_seconds=0.01,
    )

    try:
        detector.detect(_png_bytes(32, 24))
    except PixelPerfectUnavailableError as error:
        assert "超时" in str(error)
    else:
        raise AssertionError("native timeout must be reported")


def test_native_process_output_is_bounded_while_the_child_is_running():
    detector = NativeGridDetector(
        (
            sys.executable,
            "-c",
            "import sys; sys.stdin.buffer.read(); sys.stdout.buffer.write(b'x'*70000)",
        ),
        timeout_seconds=1,
    )

    try:
        detector.detect(_png_bytes(32, 24))
    except PixelPerfectUnavailableError as error:
        assert "stdout" in str(error)
    else:
        raise AssertionError("oversized native output must be rejected")


def test_native_signal_exit_is_tool_unavailable_not_bad_input():
    detector = NativeGridDetector(
        (
            sys.executable,
            "-c",
            (
                "import os,signal,sys; sys.stdin.buffer.read(); "
                "os.kill(os.getpid(), signal.SIGTERM)"
            ),
        ),
        timeout_seconds=1,
    )

    try:
        detector.detect(_png_bytes(32, 24))
    except PixelPerfectUnavailableError as error:
        assert str(signal.SIGTERM) in str(error)
    else:
        raise AssertionError("signal exit must be unavailable")


def test_endpoint_maps_local_tool_failures_to_stable_business_codes(auth_client):
    class FailingTool:
        def __init__(self, error: Exception) -> None:
            self.error = error

        def process(self, _source, *, colors, pixel_size):
            raise self.error

    cases = [
        (PixelPerfectInputError("bad image"), BizCode.BAD_REQUEST),
        (PixelPerfectBusyError("busy"), BizCode.TOO_MANY_REQUESTS),
        (PixelPerfectUnavailableError("missing"), BizCode.MODEL_UNAVAILABLE),
    ]
    for error, expected_code in cases:
        auth_client.app.state.pixel_perfect_tool = FailingTool(error)
        response = auth_client.post(
            "/tools/pixel-perfect",
            files={"file": ("source.png", _png_bytes(), "image/png")},
        )
        assert response.json()["code"] == expected_code


def test_application_wires_the_standalone_pixel_perfect_tool(auth_client):
    assert isinstance(auth_client.app.state.pixel_perfect_tool, PixelPerfectTool)


def test_tool_rejects_parallel_work_when_its_local_slot_is_busy():
    entered = Event()
    release = Event()

    class BlockingReconstructor(_GridReconstructor):
        def reconstruct(self, source, *, cols, rows, colors):
            entered.set()
            release.wait(timeout=1)
            return super().reconstruct(source, cols=cols, rows=rows, colors=colors)

    tool = PixelPerfectTool(
        detector=_GridDetector(_detected_grid()),
        reconstructor=BlockingReconstructor(),
        max_concurrency=1,
    )
    source = _png_bytes(32, 24)

    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(tool.process, source, colors=32, pixel_size=None)
        assert entered.wait(timeout=1)
        try:
            tool.process(source, colors=32, pixel_size=None)
        except PixelPerfectBusyError:
            pass
        else:
            raise AssertionError("parallel processing must be rejected")
        release.set()
        assert first.result(timeout=1).png.startswith(b"\x89PNG")


def test_request_limit_counts_streamed_bytes_without_trusting_content_length():
    called = False

    async def app(scope, receive, send):
        nonlocal called
        called = True
        while (await receive()).get("more_body"):
            pass

    middleware = PixelPerfectRequestLimitsMiddleware(app, max_body_bytes=5)
    messages = iter(
        [
            {"type": "http.request", "body": b"1234", "more_body": True},
            {"type": "http.request", "body": b"56", "more_body": False},
        ]
    )
    sent = []

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/tools/pixel-perfect",
        "headers": [(b"content-length", b"1")],
    }
    asyncio.run(middleware(scope, receive, send))

    assert called
    assert sent[0]["status"] == 200
    assert b'"code":400' in sent[1]["body"]


def test_openapi_declares_png_success_and_json_business_errors(auth_client):
    response = auth_client.get("/openapi.json").json()["paths"]["/tools/pixel-perfect"][
        "post"
    ]["responses"]["200"]["content"]

    assert {"image/png", "application/json"} <= set(response)
    assert "schema" in response["application/json"]
