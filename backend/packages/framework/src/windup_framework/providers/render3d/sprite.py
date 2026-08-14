"""``SpriteRenderProvider`` 的本地实现:绑骨模型 bytes → 各朝向序列帧 bytes。

**这一段零 API 成本**,失败可以随便重试 —— 也正因为如此,它是整条链路上唯一能反复实验的
一段,前面两段每跑一次都扣积分。

多朝向是三渲二相对逐帧 / 视频路线的主要杠杆:模型与动作都不变,**只换相机方位角重渲一遍**,
各朝向天生一致(同一网格、同一骨骼、同一采样时刻)。逐帧 / 视频路线做同样的事是 N 倍生成
费用,而且各朝向之间没有一致性保证。

实现形态:临时目录当 docroot(模型 + 出帧台页面 + 指向 three 的软链) → 起一个本地
HTTP 服务 → node + playwright 驱动出帧台 → 读回 PNG bytes。
**bytes 进 bytes 出**:落盘只是本实现内部的事,不外泄给调用方(与 uploader 那条约定同源 ——
"该 provider 自己的适配问题")。
"""
from __future__ import annotations

import functools
import http.server
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import threading
from collections.abc import Mapping

from .checks import sniff_format
from .interfaces import (
    RENDER_SIZE,
    RenderStageError,
    RigInfo,
    SpriteSequence,
    SpriteSheet,
)

__all__ = ["LocalSpriteRenderProvider", "DIRECTIONS_4", "DIRECTIONS_8", "MATERIALS"]

STAGE_DIR = pathlib.Path(__file__).resolve().parent / "stage"

# 朝向名 → 相机方位角(度)。0° = 角色朝屏幕右(对齐 faces="right")。逆时针每 45° 一个,
# 八向是四向的超集。键名与前端导出模型的 ``ExportAction.sequences[].direction`` 一致,
# **不需要转换层**。
DIRECTIONS_8 = {"e": 0, "ne": 45, "n": 90, "nw": 135, "w": 180, "sw": 225, "s": 270, "se": 315}
DIRECTIONS_4 = {"e": 0, "n": 90, "w": 180, "s": 270}

# 出帧台**真正认识**的材质取值,每个对应一个不同的渲染分支。
#
# 这张表存在的唯一理由是一个仪器陷阱:管线那份出帧台的材质分支只认三种取值,其余(包括
# ``cel`` / ``studio``)静默落到同一个分支 —— 于是"拿两种材质做对照"实际上根本没换材质,
# 得出的结论不作数。本 provider 因此**在边界上校验**,认不出的取值当场抛;出帧台内部也
# 独立抛一次(双保险,免得有人绕过 provider 直接开页面)。
MATERIALS = ("cel", "lit", "clay", "toon", "orig")

_EXT = {"GLB": "glb", "FBX": "fbx"}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _is_dir(p: pathlib.Path) -> bool:
    """``p.is_dir()``,但把"问不出来"当成 False。

    向上搜 node_modules 会一路走到 ``/``,而根下有些合成入口对 ``stat`` 直接报错而不是
    返回"不存在":macOS 上 ``/.resolve/node_modules/three`` 抛 ``OSError(EINVAL)``,
    于是整条发现逻辑连同**所有**依赖它的用例一起崩(本机实测 6 个用例红,与被测代码无关)。
    找不到 three.js 是一种正常结果(调用方另有报错路径),搜索途中问不出来更是,
    两者都不该表现成崩溃。
    """
    try:
        return p.is_dir()
    except OSError:
        return False


def _find_dir(candidates: list[pathlib.Path]) -> pathlib.Path | None:
    return next((c for c in candidates if _is_dir(c)), None)


def _discover_three(levels: int = 6) -> pathlib.Path | None:
    """找一份 three.js。显式参数 > ``WINDUP_THREE_DIR`` > 从 cwd / 包目录向上搜 node_modules。

    向上每一层还会看**该层的直接子目录**:这条线的出帧资产历史上住在某个子目录的
    node_modules 里,不写死具体名字,只按 ``*/node_modules/three`` 这个通用形状找。
    搜索深度封顶(``levels``),免得在深路径上把整棵树 iterdir 一遍。

    产品仓里 three 是普通 npm 依赖,这个函数第一条就命中,后面几条都用不上。
    """
    env = os.environ.get("WINDUP_THREE_DIR")
    if env:
        return pathlib.Path(env)
    roots: list[pathlib.Path] = []
    for start in (pathlib.Path.cwd(), STAGE_DIR.parent):
        roots += [start, *list(start.parents)[:levels]]
    for root in roots:
        direct = root / "node_modules" / "three"
        if _is_dir(direct):
            return direct
        try:
            children = sorted(c for c in root.iterdir() if c.is_dir())
        except OSError:
            continue
        nested = _find_dir([c / "node_modules" / "three" for c in children])
        if nested:
            return nested
    return None


def _discover_playwright() -> str | None:
    """找 playwright 入口。装在项目里时让 node 自己解析(返回 None)即可。"""
    env = os.environ.get("PLAYWRIGHT_MODULE")
    if env:
        return env
    globals_ = [pathlib.Path.home() / ".npm-global/lib/node_modules/playwright",
                pathlib.Path("/usr/local/lib/node_modules/playwright"),
                pathlib.Path("/opt/homebrew/lib/node_modules/playwright")]
    found = _find_dir(globals_)
    return str(found / "index.mjs") if found else None


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:      # 出帧一次上百个请求,日志没有信息量
        pass


class LocalSpriteRenderProvider:
    """本地出帧 provider。

    ``three_dir`` / ``playwright_module`` 留成构造参数是为了搬仓:产品仓里它们是普通的
    npm 依赖,一行都不用传;在本仓靠 :func:`_discover_three` / :func:`_discover_playwright`
    自动找。
    """

    def __init__(
        self,
        *,
        three_dir: str | pathlib.Path | None = None,
        playwright_module: str | None = None,
        node: str = "node",
        min_coverage: float = 0.005,
        timeout_s: int = 900,
    ) -> None:
        self._three = pathlib.Path(three_dir) if three_dir else _discover_three()
        self._pw = playwright_module or _discover_playwright()
        self._node = node
        self._min_coverage = min_coverage
        self._timeout = timeout_s

    # ── Protocol ────────────────────────────────────────────────────────────

    def render(
        self,
        rigged_model: bytes,
        *,
        clip: str | None = None,
        directions: int = 4,
        frames: int = 12,
        size: tuple[int, int] = RENDER_SIZE,
        material: str = "cel",
    ) -> SpriteSheet:
        if directions not in (4, 8):
            raise ValueError(f"朝向数只支持 4 或 8(八向是四向的超集),收到 {directions}")
        if material not in MATERIALS:
            raise ValueError(
                f"未知材质 {material!r};出帧台只认 {MATERIALS}。"
                "别指望它会兜底 —— 静默落到同一分支正是这条线踩过的仪器陷阱。")
        if frames < 1:
            raise ValueError(f"帧数至少 1,收到 {frames}")
        fmt = sniff_format(rigged_model)               # 嗅探,不由调用方声明
        if self._three is None:
            raise RenderStageError(
                "找不到 three.js。装一份(npm i three)或用 WINDUP_THREE_DIR / "
                "LocalSpriteRenderProvider(three_dir=...) 指过去。")

        table = DIRECTIONS_8 if directions == 8 else DIRECTIONS_4
        with tempfile.TemporaryDirectory(prefix="windup_bake_") as tmp:
            root = pathlib.Path(tmp)
            docroot = root / "www"
            docroot.mkdir()
            model_name = f"model.{_EXT[fmt]}"
            (docroot / model_name).write_bytes(rigged_model)
            shutil.copy2(STAGE_DIR / "bake_stage.html", docroot / "bake_stage.html")
            # 软链而不是拷贝:three 整包上百 MB,每次出帧拷一遍纯属浪费。
            (docroot / "three").symlink_to(self._three.resolve(), target_is_directory=True)

            out = root / "out"
            out.mkdir()
            port = _free_port()
            server = http.server.ThreadingHTTPServer(
                ("127.0.0.1", port),
                functools.partial(_QuietHandler, directory=str(docroot)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                meta = self._drive(port, model_name, out, table, clip, frames, size, material)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
            return self._collect(meta, out, table)

    # ── 内部 ────────────────────────────────────────────────────────────────

    def _drive(self, port: int, model_name: str, out: pathlib.Path,
               table: Mapping[str, int], clip: str | None, frames: int,
               size: tuple[int, int], material: str) -> Mapping:
        w, h = size
        url = (f"http://127.0.0.1:{port}/bake_stage.html?model=/{model_name}"
               f"&mat={material}&w={w}&h={h}")
        env = {
            **os.environ,
            "STAGE_URL": url, "OUT": str(out),
            "DIRS": json.dumps([[k, v] for k, v in table.items()]),
            "CLIP": clip or "", "N": str(frames),
            "MIN_COVERAGE": str(self._min_coverage),
        }
        if self._pw:
            env["PLAYWRIGHT_MODULE"] = self._pw
        try:
            proc = subprocess.run(
                [self._node, str(STAGE_DIR / "bake_driver.mjs")],
                env=env, capture_output=True, text=True, timeout=self._timeout)
        except FileNotFoundError as exc:
            raise RenderStageError(f"起不来 node({self._node}):{exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise RenderStageError(f"出帧超时({self._timeout}s)") from exc
        if proc.returncode == 2:
            # 空帧自检。**不让全透明帧冒充成功** —— 这一步在管线里是拿教训换来的:
            # 三帧 alpha 全 0,外层照样打印"N 帧 时长…",没有任何告警。
            raise RenderStageError(f"出帧台空帧自检不通过:\n{proc.stderr.strip()}")
        if proc.returncode != 0:
            raise RenderStageError(
                f"出帧失败(退出码 {proc.returncode}):\n{proc.stderr.strip() or proc.stdout.strip()}")

        meta_path = out / "bake_meta.json"
        if not meta_path.exists():
            raise RenderStageError(f"出帧台没写 bake_meta.json;stdout:\n{proc.stdout.strip()}")
        return json.loads(meta_path.read_text())

    def _collect(self, meta: Mapping, out: pathlib.Path,
                 table: Mapping[str, int]) -> SpriteSheet:
        sequences = []
        for name, yaw in table.items():
            frame_dir = out / name
            files = sorted(frame_dir.glob("f*.png"))
            if not files:
                raise RenderStageError(f"朝向 {name} 一帧都没出({frame_dir})")
            sequences.append(SpriteSequence(direction=name, camera_yaw=float(yaw),
                                            frames=tuple(f.read_bytes() for f in files)))
        rig = meta.get("rig") or {}
        return SpriteSheet(
            clip=str(meta["clip"]),
            duration_s=float(meta.get("duration") or 0.0),
            sample_times=tuple(meta.get("sample_times") or ()),
            sequences=tuple(sequences),
            rig=RigInfo(
                bones=int(rig.get("bones", 0)),
                skinned_meshes=int(rig.get("skinned", 0)),
                vertices=int(rig.get("verts", 0)),
                root_bone=rig.get("rootBone"),
                loader=str(rig.get("loader", "?")),
            ),
            available_clips=dict(meta.get("clips") or {}),
            root_motion=meta.get("root_motion"),
        )
