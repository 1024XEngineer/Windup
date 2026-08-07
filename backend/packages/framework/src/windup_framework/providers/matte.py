"""主体抠图 MatteProvider —— onnxruntime 直跑 u2netp,不依赖 rembg。

为什么不用 rembg:rembg → pymatting → numba 0.53 / llvmlite 0.36 这条老链在 Python
3.12 无轮子(实测装不上)。而 rembg 内核就是"u2netp.onnx 过一遍 onnxruntime";默认
``alpha_matting=False`` 时根本不碰 pymatting。故直调 onnxruntime,甩掉整条死重依赖,
3.12 干净可装、可进 lock。同模型(u2netp),同质量。

模型解析顺序:显式 ``model_path`` → 缓存目录已存在 → 从 ``model_url`` 惰性下载。
onnxruntime 惰性导入(启动慢、按需加载),会话按需构建一次。
"""
from __future__ import annotations

import io
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from .interfaces import MatteProvider

# u2netp:轻量版(~4.7MB)。rembg 官方 release 托管;国内不可达时可预置 model_path。
_U2NETP_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
_DEFAULT_CACHE = Path.home() / ".cache" / "windup" / "u2netp.onnx"

# u2net 预处理常量(与 rembg 一致)。
_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)
_SIZE = (320, 320)


class OnnxU2NetMatteProvider(MatteProvider):
    """u2netp.onnx via onnxruntime。frame bytes → 抠好的 PNG(RGBA) bytes。"""

    def __init__(self, model_path: str | Path | None = None, model_url: str = _U2NETP_URL) -> None:
        self._model_path = Path(model_path) if model_path else _DEFAULT_CACHE
        self._model_url = model_url
        self._session = None  # 惰性

    def _ensure_model(self) -> Path:
        if not self._model_path.exists():
            self._model_path.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(self._model_url, self._model_path)
        return self._model_path

    def _get_session(self):
        if self._session is None:
            try:
                import onnxruntime as ort  # 惰性:导入慢
            except ImportError:
                return None  # onnxruntime 不可用(如 macOS x86_64),走 Pillow 兜底
            self._session = ort.InferenceSession(
                str(self._ensure_model()), providers=["CPUExecutionProvider"]
            )
        return self._session

    def _predict_mask(self, img: Image.Image) -> Image.Image:
        """u2netp 前向 → 单通道显著性 mask(L,原图尺寸)。"""
        im = img.convert("RGB").resize(_SIZE, Image.LANCZOS)
        ary = np.array(im).astype(np.float32)
        ary = ary / max(float(ary.max()), 1e-6)
        tmp = np.zeros((_SIZE[1], _SIZE[0], 3), dtype=np.float32)
        for c in range(3):
            tmp[:, :, c] = (ary[:, :, c] - _MEAN[c]) / _STD[c]
        tensor = np.expand_dims(tmp.transpose(2, 0, 1), 0).astype(np.float32)

        session = self._get_session()
        pred = session.run(None, {session.get_inputs()[0].name: tensor})[0][:, 0, :, :]
        mi, ma = float(pred.min()), float(pred.max())
        pred = (pred - mi) / max(ma - mi, 1e-6)
        mask = (pred.squeeze() * 255).astype(np.uint8)
        return Image.fromarray(mask, "L").resize(img.size, Image.LANCZOS)

    def cutout(self, frame: bytes) -> bytes:
        img = Image.open(io.BytesIO(frame)).convert("RGBA")
        session = self._get_session()
        if session is not None:
            mask = self._predict_mask(img)
        else:
            mask = self._fallback_mask(img)
        cut = Image.composite(img, Image.new("RGBA", img.size, (0, 0, 0, 0)), mask)
        buf = io.BytesIO()
        cut.save(buf, "PNG")
        return buf.getvalue()

    @staticmethod
    def _fallback_mask(img: Image.Image) -> Image.Image:
        """Pillow 兜底:取四角主色做 chroma-key 式去背(精度远低于 u2netp,仅开发用)。"""
        import numpy as np

        ary = np.array(img.convert("RGB"))
        # 取四角 8×8 采样主色
        corners = np.concatenate([
            ary[:8, :8].reshape(-1, 3),
            ary[:8, -8:].reshape(-1, 3),
            ary[-8:, :8].reshape(-1, 3),
            ary[-8:, -8:].reshape(-1, 3),
        ])
        bg = corners.mean(axis=0)
        diff = np.linalg.norm(ary.astype(float) - bg, axis=2)
        # 阈值:距离 < 60 视为背景
        mask = (diff > 60).astype(np.uint8) * 255
        return Image.fromarray(mask, "L").resize(img.size, Image.LANCZOS)
