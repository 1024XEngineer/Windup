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

# 空洞填充用。_HOLE_ALPHA:低于此 alpha 才算"透明",参与空洞判定。
# _HOLE_BG_TOL:到底色的距离低于此值 → 判为"确实是底色"。取值依据(2026-08-11 实测,
# 1280×720 真实视频帧):纯背景区域的色距 p99.9≈6.5、最大 11.1(视频压缩噪点);
# 而被误杀的浅肤色像素连通域中位色距 ≥17.1。14 落在这条 1.5 倍间隙里。
_HOLE_ALPHA = 0.03
_HOLE_BG_TOL = 14.0


def _bg_key(rgb: np.ndarray) -> np.ndarray | None:
    """四角取样估底色 key;底不够均匀(std 超阈值)时返回 None = 不做任何基于底色的判断。

    抽成独立函数是为了让"底色是什么"只有一个真相源 —— 键控清理(``_flat_bg_penalty``)
    和空洞填充(``_fill_enclosed_holes``)必须按同一个 key 判断,否则一个把某块当背景
    清掉、另一个又把它当主体填回来,互相打架。
    """
    corners = np.concatenate([
        rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
        rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3),
    ])
    if float(corners.std(axis=0).max()) > _BG_FLAT_STD:
        return None
    return np.median(corners, axis=0).astype(np.float32)


def _spread(seed: np.ndarray, region: np.ndarray) -> np.ndarray:
    """在 ``region`` 内从 ``seed`` 出发做 4-邻接连通扩散,返回可达集合。

    为什么不写逐像素 BFS:交付前的帧是 1280×720(约 92 万像素),纯 Python BFS 要几十秒,
    抠图是逐帧调用的,扛不住。这里按**行/列游程**传播 —— 一个 pass 就能把可达性推过
    整条连续游程(距离不限),而不是每 pass 只推进一个像素,真实角色轮廓几个 pass 收敛。

    同一行里被非 region 像素隔断的两段游程,``cumsum(~region)`` 必然取到不同的 id,
    因此可以用 ``bincount`` 一次算出"每条游程里有没有种子"。
    """
    reach = seed & region
    while True:
        before = int(reach.sum())
        for transposed in (False, True):
            reg = region.T if transposed else region
            rch = reach.T if transposed else reach
            rows, cols = reg.shape
            run = np.cumsum(~reg, axis=1)
            keys = run + np.arange(rows)[:, None] * (cols + 1)
            hit = np.bincount(keys[rch], minlength=rows * (cols + 1)) > 0
            new = reg & hit[keys]
            reach = new.T if transposed else new
        if int(reach.sum()) == before:
            return reach


def _fill_enclosed_holes(alpha: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    """把"被主体围住、且整块都不是底色"的透明连通域填回主体(alpha=1)。

    要解决的问题:u2netp 判错或键控误杀会在主体内部留下透明洞,放大看是背景直接透出来。

    **为什么只判"不与边界连通"不够 —— 会把两腿之间填实。** 直觉上腿间空隙从下方通到
    画面底边,所以"从边界出发的连通域"就能保护它。2026-08-11 在真实走路帧上实测:
    **不成立**。迈步相里两只靴子在下方交叠,把腿间空隙彻底封死 —— 它就是一块不与边界
    连通的背景域(实测 src_017 有 530 像素、归档 frame_03 有 129 像素),只按连通性判,
    这一整块会被填成主体,两条腿直接焊在一起。

    所以判据是**连通性 + 颜色**两条一起:一个透明连通域只要"碰到画面边界"或者"里面
    存在任何一个确实是底色的像素",就不是洞。腿间空隙整块就是底色(实测中位色距 6.2,
    远低于 _HOLE_BG_TOL),必然被这条否决;而被误杀的主体像素(实测中位色距 ≥17.1)
    不含底色像素,才会被填。两条否决合成一次扩散:种子 = 边界上的透明像素 ∪ 底色像素。

    与 ``_flat_bg_penalty`` 的分工:那个函数按颜色**做减法**(把闭合空隙里的底色清掉),
    这个函数按颜色**决定不加回来** —— 同一个 key、同一个方向,不会互相拆台。
    """
    key = _bg_key(rgb)
    if key is None:
        return alpha                      # 底不是纯色 → 无从判断哪块是真空隙,一律不填
    transparent = alpha < _HOLE_ALPHA
    if not transparent.any():
        return alpha
    border = np.zeros_like(transparent)
    border[0, :] = border[-1, :] = True
    border[:, 0] = border[:, -1] = True
    is_bg_color = np.linalg.norm(rgb - key, axis=2) < _HOLE_BG_TOL
    seed = transparent & (border | is_bg_color)
    holes = transparent & ~_spread(seed, transparent)
    if not holes.any():
        return alpha
    out = alpha.copy()
    out[holes] = 1.0
    return out


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
    key = _bg_key(rgb)
    if key is None:
        return np.ones(rgb.shape[:2], dtype=np.float32)   # 底不是纯色 → 不动
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
        rgb = np.asarray(img.convert("RGB"), dtype=np.float32)
        alpha = np.asarray(self._predict_mask(img), dtype=np.float32) / 255.0
        alpha = alpha * _flat_bg_penalty(rgb)
        alpha = _fill_enclosed_holes(alpha, rgb)
        out = np.dstack([np.asarray(img.convert("RGB")), alpha * 255.0]).astype(np.uint8)
        buf = io.BytesIO()
        Image.fromarray(out, "RGBA").save(buf, "PNG")
        return buf.getvalue()
