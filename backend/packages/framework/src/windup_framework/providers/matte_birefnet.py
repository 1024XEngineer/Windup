"""BiRefNet 抠图 provider。

为什么换掉 u2net(2026-08-25 实测,同一帧同一判据):u2net 是**显著性检测**模型,输入固定
320×320,对与背景亮度接近的区域给不出满置信度 —— 银甲与剑刃的 alpha 落在 234 左右,
肉眼在浅底上看不出,合到深底或参与降采样取色时就是一层灰雾。主体内部非实心像素 5,541 个,
位置正是 ``matte`` 里那句"浅肤色角色的脸颊与小腿"所描述的老问题。

BiRefNet 输入 1024×1024,同一帧上主体内部非实心降到 106 个(-98%)。**但它单用更差**:
沿整条轮廓把角色自己的深色描边切掉了(丢主体 1,845 px 对 u2net 的 228),而像素画的黑边
是主体的一部分,不是抗锯齿。故取两者逐像素较大 alpha —— 与本模块 u2netp+u2net 取 max
同一思路:漏检位置不重叠时并集全胜。同一帧实测:

    方案            IoU      丢主体   内部非实心
    u2net         0.9769      228      5541
    BiRefNet      0.9668     1845       106
    两者并集       0.9764       53        91

代价是 CPU 约 6s/帧 对 0.7s/帧,故本 provider 不替换 :class:`OnnxU2NetMatteProvider`,
而是与它并存,由调用方按"这一帧值不值 6 秒"选择。

RMBG-2.0 在公开评测上更强(90% 对 85%),但它是 CC BY-NC 4.0,商用需单独向 BRIA 购买
授权;BiRefNet 是 MIT,可直接用。这是"可商用范围内最好的"。
"""

from __future__ import annotations

import io
import threading
import logging
from pathlib import Path

import numpy as np
from PIL import Image

from .interfaces import MatteProvider
from .matte import _RUN_LOCK
from .matte import _download_atomic, _fill_enclosed_holes, _flat_bg_penalty

logger = logging.getLogger("windup.matte.birefnet")

# BiRefNet_lite 的 ONNX 导出(MIT)。fp16 版同目录也有,但**不要用**:CPU 无原生 fp16
# 算力,实测反而慢一倍(12.4s 对 6.0s),而掩膜只差 11 个像素。
_URL = (
    "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/"
    "resolve/main/onnx/model.onnx"
)
_CACHE = Path.home() / ".cache" / "windup" / "birefnet" / "lite_model.onnx"

# 与 BiRefNet 训练时一致的 ImageNet 归一化。
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

#: 模型的输入尺寸是**固定**的,不是建议值:导出图里写死 [1,3,1024,1024],
#: 喂 512 会以 InvalidArgument 失败(实测),所以不提供可调分辨率。
_SIDE = 1024


class BiRefNetMatteProvider(MatteProvider):
    """frame bytes → 抠好的 RGBA PNG bytes。

    键控清理与空洞填充复用 :mod:`.matte` 的实现 —— 那两步与用哪个显著性模型无关,
    抄一份只会让"底色是什么"出现第二个真相源。
    """

    def __init__(self, model_path: str | Path | None = None, union_with_u2net: bool = True) -> None:
        """``union_with_u2net`` 默认开:BiRefNet 单用会切掉角色的深色描边(见模块 docstring)。
        关掉只在需要单独评测这一个模型时用。"""
        self._path = Path(model_path) if model_path else _CACHE
        self._session = None
        self._union = union_with_u2net
        self._init_lock = threading.Lock()
        self._u2net = None

    def _ensure_model(self) -> Path:
        if not self._path.exists():
            logger.info("下载 BiRefNet 模型 → %s", self._path)
            _download_atomic(_URL, self._path)
        return self._path

    def _get_session(self):
        if self._session is None:
            import onnxruntime as ort

            self._session = ort.InferenceSession(
                str(self._ensure_model()), providers=["CPUExecutionProvider"]
            )
        return self._session

    def warmup(self) -> None:
        """把会话装进内存。**必须有这个方法** —— 没有它整条接线会静默失效。

        ``bootstrap.worker`` 是 ``matte.warmup()`` 然后 ``bind_matte(matte)``,两句包在
        同一个 ``except Exception`` 里。缺 ``warmup`` 时第一句抛 AttributeError,
        **``bind_matte`` 就到不了** —— 于是三个 executor 各自惰性 new 一份 provider,
        而本类默认 ``union_with_u2net=True``,每份内部再 new 一个 u2net,进程里就是
        6 个 ONNX 会话。生产 worker 容器上限 5GiB,而本模型单帧峰值 6.85GB。
        表面上只有一条 "ONNX 预热失败" 的 WARNING,开发机上完全跑得通。

        并集那一路的 u2net 也一并预热:它是每帧都要跑的,留到首帧再装等于把两次冷启动
        叠在一起。
        """
        self._get_session()
        if self._union:
            self._ensure_u2net().warmup()

    def _ensure_u2net(self):
        """并集那一路的 u2net,**带锁的惰性初始化**。

        原先是 ``if self._u2net is None: self._u2net = ...`` 的检查后赋值,两个线程能
        同时通过检查、各建一份 —— 而每份自带一套 ONNX 会话。worker 的生成并发是
        IMAGE=4 / ACTION=2,这个竞态在生产上是够得着的。
        """
        with self._init_lock:
            if self._u2net is None:
                from .matte import OnnxU2NetMatteProvider

                self._u2net = OnnxU2NetMatteProvider()
            return self._u2net

    def _predict_mask(self, img: Image.Image) -> Image.Image:
        session = self._get_session()
        arr = np.asarray(
            img.convert("RGB").resize((_SIDE, _SIDE), Image.LANCZOS), dtype=np.float32
        )
        tensor = (((arr / 255.0) - _MEAN) / _STD).transpose(2, 0, 1)[None]
        # **与 u2net 共用同一把锁**,让进程里同时只有一个 ONNX 前向在跑。
        #
        # 这一路的单帧峰值是 6.85GB(u2net 是 1.10GB),而 worker 的生成并发是
        # IMAGE=4 / ACTION=2 —— 不串行的话四路并发前向就是四份激活值同时在内存里,
        # 谁都装不下。u2net 那边早就这么做了(见 matte._RUN_LOCK 上方那段注释:
        # "进程内串行 Run,吞吐靠多 worker 进程而不是同一进程里叠会话"),本类漏了。
        #
        # 共用而不是各持一把:并集模式下两个模型每帧都要各跑一次,各持一把锁只能保证
        # "同类不并发",跨类照样叠 6.85+1.10。锁的作用域只包住 run 本身,
        # 下面调 u2net 时这把锁已经释放,不会自锁。
        with _RUN_LOCK:
            outputs = session.run(
                None, {session.get_inputs()[0].name: tensor.astype(np.float32)}
            )
        # 多尺度监督的导出会给一串输出,最后一个是最高分辨率的那张;取 [0] 会拿到
        # 1/32 尺度的粗图,放大回来就是一团模糊。
        raw = np.asarray(outputs[-1] if isinstance(outputs, list) else outputs).squeeze()
        raw = raw.astype(np.float32)
        if raw.min() < 0.0 or raw.max() > 1.0:
            raw = 1.0 / (1.0 + np.exp(-raw))          # 导出未带 sigmoid 时补上
        return Image.fromarray((raw * 255.0).astype(np.uint8), "L").resize(
            img.size, Image.LANCZOS
        )

    def cutout(self, frame: bytes) -> bytes:
        img = Image.open(io.BytesIO(frame)).convert("RGBA")
        rgb = np.asarray(img.convert("RGB"), dtype=np.float32)
        alpha = np.asarray(self._predict_mask(img), dtype=np.float32) / 255.0
        if self._union:
            other = np.asarray(
                Image.open(io.BytesIO(self._ensure_u2net().cutout(frame))).convert("RGBA")
            )[:, :, 3].astype(np.float32) / 255.0
            alpha = np.maximum(alpha, other)
        alpha = alpha * _flat_bg_penalty(rgb)
        alpha = _fill_enclosed_holes(alpha, rgb)
        out = np.dstack([np.asarray(img.convert("RGB")), alpha * 255.0]).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(out, "RGBA").save(buf, format="PNG")
        return buf.getvalue()
