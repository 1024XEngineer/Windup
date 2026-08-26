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
import logging
import os
import shutil
import tempfile
import threading
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

from .interfaces import MatteProvider

logger = logging.getLogger("windup.matte")

# POLL>1 时两路 cutout 会并发 Run;CPU EP 允许并发,但默认 intra_op 吃满核、arena 叠两份。
# 进程内串行 Run,吞吐靠多 worker 进程而不是同一进程里叠会话。
_RUN_LOCK = threading.Lock()

# 4C8G 可关全量 u2net(~176MB):WINDUP_MATTE_REFINE=0。浅肤色脸颊/小腿可能漏检。
_REFINE_OFF = frozenset({"0", "false", "no", "off"})

# u2netp:轻量版(~4.4MB)。rembg 官方 release 托管;国内不可达时可预置 model_path。
_U2NETP_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
_DEFAULT_CACHE = Path.home() / ".cache" / "windup" / "u2netp.onnx"

# 全量版(~176MB)。它不是"更好的轻量版",两者漏检的位置不重叠:
#   · 轻量版把浅肤色角色的脸颊与小腿判成背景(测试反馈的"浅色角色被抠穿"就是这个);
#   · 全量版把 T-pose 平举的细手臂整条丢掉。
# 所以取两张 alpha 的逐像素较大值,而不是二选一。实测 9 张:主体覆盖 14.78% → 15.77%,
# 漏检最严重那张(林间斥候)的洞从 11.69% 降到 0.06%,代价是 0.27s/帧 → 0.77s/帧。
_U2NET_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"
_REFINE_CACHE = Path.home() / ".cache" / "windup" / "u2net.onnx"

# u2net 预处理常量(与 rembg 一致)。
_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)
_SIZE = (320, 320)


# 只清理"几乎精确等于底色"的像素。阈值必须窄:2026-08-07 实测,一个铁锈橙毛
# (222,130,70)的角色配玫红底(222,41,124),两者红通道完全相同、欧氏距离仅 104 ——
# 宽阈值会把毛判成半透明并去"反解",越解越坏(先成橄榄绿再成亮绿)。橙毛 d≈117,
# 阈值 38 完全碰不到它;而闭合空隙里的背景 d≈0,能干净移除。
# 杀伤半径不是常数,由实测的底色噪声推出来 —— 见 _kill_radius。下面两个是它的上下限。
#
# 固定阈值 38 抠穿过浅色角色:骨白角色到白底的距离只有 28.7,整块本体被判成背景;
# 39~52 这一档不被杀但整块变半透明,角色发虚而不报任何异常。深色角色距离 300 以上,
# 永远不沾这个窗口 —— 所以症状只出现在浅色角色身上。
_KEY_KILL_MIN = 6.0     # 下限:再干净的底也留一点余量,否则压缩噪声会漏清
_KEY_KILL_MAX = 24.0    # 上限:真空隙就是渲染出来的底色本身,不需要比这更宽
_KEY_NOISE_K = 4.0      # 半径 = 底色噪声标准差 × 此系数
_KEY_SOFT = 14.0    # 到杀伤半径 + 此值之间线性过渡,避免硬边锯齿
_BG_FLAT_STD = 8.0  # 四角色标准差上限;超过说明底不是纯色,不做任何清理

# 采样前先丢掉最外圈像素。视频帧的最外一两行/列常是**编码器边缘伪影**,不是底色:
# 2026-08-10 实测 9 段真 i2v 视频 × 16 帧 = 144 帧,贴边采样时 26 帧(18%)判"底不均匀"
# 而跳过清理,逐一查证全部由最外圈造成 —— 白底母版视频最右一列整列纯黑(std 50.4),
# 待机视频最顶一行偏暗(std 8.4,恰好压线越过 8)。往里让 1 px 就降到 1.9、让 2 px 降到 1.88,
# 144 帧零误跳;三张静态母版的取样中位色一个字节都没变(220/64/135、222/39/130、222/41/124)。
# 取 2 是为容下 2 px 宽的边框;真正不均匀的底(噪声/渐变/拼色)让多少都照样超阈值,守卫不松。
_EDGE_SKIP = 2
_CORNER = 12        # 每个角的采样块边长


def _refine_enabled() -> bool:
    return os.environ.get("WINDUP_MATTE_REFINE", "1").strip().lower() not in _REFINE_OFF


def _ort_session(path: Path):
    """CPU 会话:关 arena、intra_op=1,避免 4C8G 上预分配后 RSS 不回落。"""
    import onnxruntime as ort

    opt = ort.SessionOptions()
    opt.enable_cpu_mem_arena = False
    opt.intra_op_num_threads = 1
    return ort.InferenceSession(
        str(path), sess_options=opt, providers=["CPUExecutionProvider"]
    )


def _download_atomic(url: str, dest: Path) -> None:
    """下到同目录的临时文件,整个传完再原子改名。

    直接写目标路径的话,176MB 传到一半断开会留下一个不完整文件,而之后每次都靠
    ``exists()`` 判断"已经有了" —— 网络恢复了也不会重下,ONNX 会话建不起来,这台机器
    就长期退回单模型,而单模型正是会把浅肤色角色抠穿的那条路。同目录是为了让 replace
    落在同一文件系统上,跨设备改名不是原子的。
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=dest.parent, suffix=".part", delete=False) as tmp:
        part = Path(tmp.name)
    try:
        with urllib.request.urlopen(url) as resp, part.open("wb") as out:
            shutil.copyfileobj(resp, out)
        part.replace(dest)
    except BaseException:
        part.unlink(missing_ok=True)
        raise


def _saliency(session, tensor: np.ndarray) -> np.ndarray:
    """一个 u2net 会话的前向 → 归一化到 [0,1] 的二维显著性图。"""
    with _RUN_LOCK:
        pred = session.run(None, {session.get_inputs()[0].name: tensor})[0][:, 0, :, :]
    mi, ma = float(pred.min()), float(pred.max())
    return ((pred - mi) / max(ma - mi, 1e-6)).squeeze()


def _corner_pixels(rgb: np.ndarray) -> np.ndarray:
    """四角采样块(跳过最外圈 ``_EDGE_SKIP`` 像素)拼成的 (N, 3) 像素表。

    图太小时(四角会互相重叠)不让,退回贴边取 —— 合成测试图和缩略图走这条路。
    """
    k = _CORNER
    s = _EDGE_SKIP if min(rgb.shape[:2]) > 2 * (_EDGE_SKIP + k) else 0
    r = rgb[s : rgb.shape[0] - s, s : rgb.shape[1] - s] if s else rgb
    return np.concatenate([
        r[:k, :k].reshape(-1, 3), r[:k, -k:].reshape(-1, 3),
        r[-k:, :k].reshape(-1, 3), r[-k:, -k:].reshape(-1, 3),
    ])


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
    清掉、另一个又把它当主体填回来,互相打架。取样统一走 :func:`_corner_pixels`,
    连"跳过最外圈编码器伪影"这条也只有一份实现。
    """
    corners = _corner_pixels(rgb)          # 跳过编码器边缘伪影,见 _EDGE_SKIP
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


def _kill_radius(rgb: np.ndarray) -> float:
    """按四角实测的底色噪声定杀伤半径,而不是取一个固定常数。

    要清掉的是**渲染出来的底色本身**(被主体围住的那块空隙),它与四角同源,差异只来自
    压缩噪声,量级由四角的离散度直接给出。固定常数没有这个信息,取宽了就会吃掉与底色
    接近的角色像素 —— 浅色角色正是落在那个窗口里。

    上限的意义:底噪再大也不该把半径放到能吞掉主体的程度;超过上限时宁可少清一点,
    留下的底色是可见的脏边,而抠穿角色是不可逆的破坏。
    """
    spread = float(_corner_pixels(rgb).std(axis=0).max())
    return float(np.clip(spread * _KEY_NOISE_K, _KEY_KILL_MIN, _KEY_KILL_MAX))


def _flat_bg_penalty(rgb: np.ndarray) -> np.ndarray:
    """底色清理系数(0=纯背景,1=主体),形状与图同宽高。

    为什么需要它:u2netp 是显著性模型,对**闭合区域**天然失灵 —— 四足角色腿间的
    背景是一块被主体围住的空隙,显著性把它当成主体内部,整块底色留在产物里
    (2026-08-07 实测)。而母版底色是刻意生成的纯色,均匀度极高(实测四角标准差 1.0~1.2),
    用它做一次窄阈值清理就能补上这个洞。

    与"按颜色抠是死路"那条规则的边界:那条说的是**拿颜色当主体判据**。这里主体判据仍然是
    u2netp,颜色只用来做减法。但减法同样会减在角色身上 —— 本函数是乘性惩罚、作用于全图,
    与底色足够接近的**主体内部**像素照样归零。所以杀伤半径必须窄到只覆盖底色自身的噪声,
    由 :func:`_kill_radius` 按四角离散度推出。底色不够均匀时(std 超阈值)返回全 1,不清理。

    **逐帧独立采样是安全的**(2026-08-10 在真视频帧上验证):同一段视频里逐帧算出的 key 色
    几乎不动(9 段 i2v 实测帧间位移 <= 1.73/255),故不需要跨帧共享一次采样。序列帧真正的
    闪烁源是**守卫在序列中途翻转**(部分帧清、部分帧不清):待机那段 16 帧里前 6 帧清、后 10 帧
    不清,主体面积逐帧变化 CV 从 0.0036 跳到 0.0197、第 6 帧单帧跳 4.25%。跳过最外圈后
    守卫不再翻转,CV 回到 0.0028 —— 比完全不清理还稳(清理同时抹掉了会自己抖的底色描边)。
    """
    key = _bg_key(rgb)
    if key is None:
        return np.ones(rgb.shape[:2], dtype=np.float32)   # 底不是纯色 → 不动
    d = np.linalg.norm(rgb - key, axis=2)
    return np.clip((d - _kill_radius(rgb)) / _KEY_SOFT, 0.0, 1.0).astype(np.float32)


class OnnxU2NetMatteProvider(MatteProvider):
    """u2net onnx via onnxruntime。frame bytes → 抠好的 PNG(RGBA) bytes。

    两个模型的 alpha 取逐像素较大值 —— 理由见 :data:`_U2NET_URL` 上方。补充模型取不到时
    退回单模型并留一条 WARNING:少一层补漏仍能出产物,而为了它整条生成失败不值得;但
    "少了一层"必须留痕,否则浅色角色被抠穿会被当成模型本身的水平。
    """

    def __init__(
        self,
        model_path: str | Path | None = None,
        model_url: str = _U2NETP_URL,
        *,
        refine_model_path: str | Path | None = None,
        refine_model_url: str | None = _U2NET_URL,
    ) -> None:
        self._model_path = Path(model_path) if model_path else _DEFAULT_CACHE
        self._model_url = model_url
        self._session = None  # 惰性
        if (
            refine_model_path is None
            and refine_model_url is _U2NET_URL
            and not _refine_enabled()
        ):
            refine_model_url = None
            logger.warning(
                "WINDUP_MATTE_REFINE 已关,只用轻量 u2netp —— 浅肤色脸颊与小腿可能被判成背景"
            )
        self._refine_path = (
            Path(refine_model_path) if refine_model_path
            else (_REFINE_CACHE if refine_model_url else None)
        )
        self._refine_url = refine_model_url
        self._refine_session = None
        self._refine_failed = False

    def _ensure_model(self) -> Path:
        if not self._model_path.exists():
            _download_atomic(self._model_url, self._model_path)
        return self._model_path

    def _get_refine_session(self):
        """补充模型的会话;取不到就永久放弃并只警告一次。"""
        if self._refine_session is not None or self._refine_failed or self._refine_path is None:
            return self._refine_session
        try:
            if not self._refine_path.exists():
                if not self._refine_url:
                    raise FileNotFoundError(self._refine_path)
                _download_atomic(self._refine_url, self._refine_path)
            try:
                self._refine_session = _ort_session(self._refine_path)
            except Exception:
                # 建会话失败说明这个文件本身不可用(上一次下载留下的残片、或版本不合)。
                # 留着它会让之后每次都跳过重下,所以就地删掉。
                self._refine_path.unlink(missing_ok=True)
                raise
        except Exception:
            self._refine_failed = True
            logger.warning(
                "抠图补充模型不可用(%s),本进程只用轻量模型 —— 浅肤色角色的脸颊与小腿"
                "可能被判成背景", self._refine_path, exc_info=True,
            )
        return self._refine_session

    def warmup(self) -> None:
        """进程启动时把两个 ONNX 会话装进内存,避免首个任务和 overlay 缺页叠在一起。"""
        self._get_session()
        self._get_refine_session()

    def _get_session(self):
        if self._session is None:
            try:
                import onnxruntime as ort  # noqa: F401 — 惰性:导入慢;会话构建见 _ort_session
            except ImportError as e:       # pragma: no cover - 取决于安装环境
                # **不静默降级。** 这里曾在 ImportError 时回落到"取四角主色做 chroma-key",
                # 有两个问题:①猜背景色 —— 白底母版四角就是白色,浅色角色(骨白/银甲)与背景
                # 撞色会被抠穿;②静默 —— 开发机上看着能跑、输出其实是坏的,要到产物验收才发现。
                raise RuntimeError(
                    "onnxruntime 不可用，无法做主体抠图。请安装 onnxruntime"
                    "（注意 <1.24 才有 macOS Intel 轮子）。"
                ) from e
            self._session = _ort_session(self._ensure_model())
        return self._session

    def _predict_mask(self, img: Image.Image) -> Image.Image:
        """两个模型各前向一次,取逐像素较大值 → 单通道显著性 mask(L,原图尺寸)。"""
        im = img.convert("RGB").resize(_SIZE, Image.LANCZOS)
        ary = np.array(im).astype(np.float32)
        ary = ary / max(float(ary.max()), 1e-6)
        tmp = np.zeros((_SIZE[1], _SIZE[0], 3), dtype=np.float32)
        for c in range(3):
            tmp[:, :, c] = (ary[:, :, c] - _MEAN[c]) / _STD[c]
        tensor = np.expand_dims(tmp.transpose(2, 0, 1), 0).astype(np.float32)

        mask = _saliency(self._get_session(), tensor)
        refine = self._get_refine_session()
        if refine is not None:
            # 归一化在每个模型内部各自做完再取 max:两个模型的原始输出量纲不同,
            # 先合并再归一化会让量纲大的那个把另一个整体压掉。
            mask = np.maximum(mask, _saliency(refine, tensor))
        return Image.fromarray(
            (mask * 255).astype(np.uint8), "L"
        ).resize(img.size, Image.LANCZOS)

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
