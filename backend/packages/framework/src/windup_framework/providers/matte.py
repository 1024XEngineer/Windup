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


# 只清理"几乎精确等于底色"的像素。阈值必须窄:2026-08-07 实测,一个铁锈橙毛
# (222,130,70)的角色配玫红底(222,41,124),两者红通道完全相同、欧氏距离仅 104 ——
# 宽阈值会把毛判成半透明并去"反解",越解越坏(先成橄榄绿再成亮绿)。橙毛 d≈117,
# 阈值 38 完全碰不到它;而闭合空隙里的背景 d≈0,能干净移除。
_KEY_KILL = 38.0    # d < 此值 → 判为纯背景
_KEY_SOFT = 14.0    # 到 _KEY_KILL + _KEY_SOFT 之间线性过渡,避免硬边锯齿
_BG_FLAT_STD = 8.0  # 四角色标准差上限;超过说明底不是纯色,不做任何清理


def _flat_bg_penalty(rgb: np.ndarray) -> np.ndarray:
    """底色清理系数(0=纯背景,1=主体),形状与图同宽高。

    为什么需要它:u2netp 是显著性模型,对**闭合区域**天然失灵 —— 四足角色腿间的
    背景是一块被主体围住的空隙,显著性把它当成主体内部,整块底色留在产物里
    (2026-08-07 实测)。而母版底色是刻意生成的纯色,均匀度极高(实测四角标准差 1.0~1.2),
    用它做一次窄阈值清理就能补上这个洞。

    与"按颜色抠是死路"那条规则的边界:那条说的是**拿颜色当主体判据**(白底浅色角色
    会被抠穿)。这里主体判据仍然是 u2netp,颜色只用来**做减法** —— 绝不新增主体像素,
    最坏情况是少清理一点,不会抠穿角色。底色不够均匀时(std 超阈值)直接返回全 1,
    等于不清理。
    """
    corners = np.concatenate([
        rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
        rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3),
    ])
    if float(corners.std(axis=0).max()) > _BG_FLAT_STD:
        return np.ones(rgb.shape[:2], dtype=np.float32)   # 底不是纯色 → 不动
    key = np.median(corners, axis=0).astype(np.float32)
    d = np.linalg.norm(rgb - key, axis=2)
    return np.clip((d - _KEY_KILL) / _KEY_SOFT, 0.0, 1.0).astype(np.float32)


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
            except ImportError as e:       # pragma: no cover - 取决于安装环境
                # **不静默降级。** 这里曾在 ImportError 时回落到"取四角主色做 chroma-key",
                # 有两个问题:①猜背景色 —— 白底母版四角就是白色,浅色角色(骨白/银甲)与背景
                # 撞色会被抠穿;②静默 —— 开发机上看着能跑、输出其实是坏的,要到产物验收才发现。
                raise RuntimeError(
                    "onnxruntime 不可用，无法做主体抠图。请安装 onnxruntime"
                    "（注意 <1.24 才有 macOS Intel 轮子）。"
                ) from e
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
        alpha = np.asarray(self._predict_mask(img), dtype=np.float32) / 255.0
        alpha = alpha * _flat_bg_penalty(np.asarray(img.convert("RGB"), dtype=np.float32))
        out = np.dstack([np.asarray(img.convert("RGB")), alpha * 255.0]).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(out, "RGBA").save(buf, "PNG")
        return buf.getvalue()
