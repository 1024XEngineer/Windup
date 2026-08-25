"""运行与 PR #495 Rust 基线相同的显式网格重建负载。"""

from __future__ import annotations

import gc
import hashlib
from io import BytesIO
import resource
import statistics
import sys
import time

import numpy as np
from PIL import Image

from windup_app.server.pixel_perfect.reconstructor import reconstruct_bytes

_RUST_RGBA_SHA256 = "c5308291f48eb22166c178ca518dc9e33f55ea7a1518fdf1667b456b440244b1"


def _fixture() -> bytes:
    y, x = np.indices((128, 128))
    group = ((x // 8) + (y // 8) * 3) % 32
    logical = np.empty((128, 128, 4), dtype=np.uint8)
    logical[:, :, 0] = (group * 47 + x * 3) % 256
    logical[:, :, 1] = (group * 29 + y * 5) % 256
    logical[:, :, 2] = (group * 71 + x + y) % 256
    logical[:, :, 3] = np.where((x + y) % 29 == 0, 0, 255)
    source = Image.fromarray(logical, "RGBA").resize(
        (1024, 1024), Image.Resampling.NEAREST
    )
    encoded = BytesIO()
    source.save(encoded, format="PNG")
    return encoded.getvalue()


def _peak_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def main() -> None:
    source = _fixture()
    gc.collect()
    baseline_rss = _peak_rss_bytes()

    warmup = reconstruct_bytes(source, cols=128, rows=128, structure_colors=32)
    elapsed_ms: list[float] = []
    result = warmup
    for _ in range(7):
        started = time.perf_counter()
        result = reconstruct_bytes(source, cols=128, rows=128, structure_colors=32)
        elapsed_ms.append((time.perf_counter() - started) * 1000)

    with Image.open(BytesIO(result.png)) as decoded:
        rgba_sha256 = hashlib.sha256(decoded.convert("RGBA").tobytes()).hexdigest()
    peak_rss = _peak_rss_bytes()
    print(f"median_ms={statistics.median(elapsed_ms):.3f}")
    print(f"runs_ms={[round(value, 3) for value in sorted(elapsed_ms)]}")
    print(f"processing_rss_delta_bytes={max(peak_rss - baseline_rss, 0)}")
    print(f"peak_rss_bytes={peak_rss}")
    print(f"rgba_sha256={rgba_sha256}")
    print(f"matches_rust_golden={rgba_sha256 == _RUST_RGBA_SHA256}")


if __name__ == "__main__":
    main()
