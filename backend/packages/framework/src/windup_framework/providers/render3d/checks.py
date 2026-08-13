"""绑骨入口预检 —— **在花钱之前**允许拒绝的那道闸。

对应 ``ai_engine.master_check`` 之于母版:那一层挡的是"喂了一张画错的图,全程无一处报错,
产出 16 帧不会走路的错角色,钱已花完才发现";这一层挡的是绑骨接口的三条**硬约束** ——

    ① 格式 GLB / FBX,**≤60MB**;
    ② 须 A-Pose 或 T-Pose;
    ③ **不得含人体以外的组件(武器、配件)**。

三条的共同点是:**违反了接口不会报错,只会默默产出错结果**。实测送入带剑的模型后,
剑被错误绑上权重、动画里到处乱甩 —— 任务"成功"、积分照扣。

**本层判什么(全部本地零成本、可复现)**

  - 能不能读 —— 不是 GLB 也不是 FBX 的 bytes(截断 / 传错文件)直接拒;
  - 体积 —— 精确可量,硬拒;
  - 姿势 —— **单侧近似**:量臂展/身高比,只在"明显不是 A/T-Pose"时拒。见
    :data:`ARM_SPAN_MIN` / :data:`ARM_SPAN_MAX` 的推导与标定说明;
  - 配件 —— **弱信号**:网格 / 节点 / 材质名里出现武器词才拒。见 :data:`ACCESSORY_TOKENS`。

**本层判不了什么 —— 别当成已经守住了**

  - **融进同一块网格的武器**。图生 3D 出的是**单块网格**:母版图里画了剑,剑就和身体
    焊在同一个 mesh 里,既没有独立节点也没有独立材质名。这种情况本层**一个信号都没有**,
    只能靠上游(母版图不画武器)保证 —— 我们的武器走刚体挂件、绑完骨再挂到手骨,天然合规。
  - **"这是不是 A/T-Pose"的正面判定**。臂展比只能证伪不能证实:一个双手前平举的姿势
    臂展比可以完全正常,但它不是 A/T-Pose。要真正判定得读骨骼 / 用视觉模型,那是另一件事。
  - **FBX 的姿势与配件**。二进制 FBX 的顶点数据在 zlib 压缩的节点记录里,没有 glTF
    ``accessor.min/max`` 那样白送的包围盒;为它写一个解析器不划算,因为**送检的本来就是
    图生 3D 出的 GLB**(FBX 是绑骨的产物、不是入参)。FBX 只做格式与体积检查,
    :attr:`ModelFacts.geometry_read` 会是 ``False`` —— 那两条这时候**测不了,只能靠调用方保证**。

纯标准库,零依赖,不联网。
"""
from __future__ import annotations

import json
import re
import struct
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from .interfaces import ModelRejectCode, ModelRejected

__all__ = [
    "MAX_UPLOAD_BYTES", "ARM_SPAN_MIN", "ARM_SPAN_MAX", "ACCESSORY_TOKENS",
    "ModelFacts", "sniff_format", "check_model", "read_glb_geometry",
]

# 接口上限 60MB。按 **10^6** 而不是 2^20 算 —— 文档只写"60MB",两种口径差 4.7%,
# 取小的那个:多拒 4.7% 的边界档,好过送上去以后默默产出错结果。
MAX_UPLOAD_BYTES = 60 * 10**6

# 臂展(横向最大跨度) / 身高 的容许区间。**单侧使用**:落在区间内不代表是 A/T-Pose,
# 落在区间外基本可以断定不是。
#
# 下限 0.45 的来路(解剖几何,不是拍的):
#   T-Pose 臂展 ≈ 身高(比值 ≈1.0);A-Pose(手臂约 45° 下垂)≈ 0.55–0.75;
#   手臂完全贴身垂下 ≈ 0.30–0.35(肩宽约 0.25H + 手臂厚度)。0.45 落在两群之间,
#   两边都留了余量。
#   **标定样本 n=1**:本仓唯一一个"送进绑骨并成功"的档 model_std_draw15k.glb 量得 0.715
#   (X 跨 0.7166 / Y 跨 1.0020)。一个样本谈不上统计标定,所以阈值取解剖推导、
#   用这个样本证伪"阈值定高了",而不是拿它去拟合。
ARM_SPAN_MIN = 0.45

# 上限 1.6:没有哪个人形 A/T-Pose 的横向跨度能到身高的 1.6 倍。超了通常意味着
# **模型是躺着的 / 轴向约定不对**(glTF 规范是 Y-up,但从 Z-up 工具导出的档会把身高
# 放到 Z 轴上,此时 max(X,Z)/Y 会冲到 3 以上)。这一条挡的是"仪器/坐标系错了",
# 与姿势本身无关 —— 但后果一样:送上去照样扣积分、照样产出错结果。
ARM_SPAN_MAX = 1.6

# 名字里出现这些词就当带武器配件。**高精度低召回**:命中基本不会错(谁会把躯干命名成
# sword),漏掉的多 —— 融进主网格的武器一个都逮不到(见模块 docstring)。
ACCESSORY_TOKENS = (
    "sword", "blade", "katana", "dagger", "knife", "axe", "spear", "lance",
    "staff", "wand", "bow", "arrow", "quiver", "gun", "rifle", "pistol",
    "shield", "weapon", "hammer", "scythe", "prop",
    "剑", "刀", "枪", "矛", "斧", "盾", "弓", "杖", "武器", "配件", "挂件",
)
_TOKEN_RE = re.compile("|".join(re.escape(t) for t in ACCESSORY_TOKENS), re.IGNORECASE)

_GLB_MAGIC = b"glTF"
_FBX_MAGIC = b"Kaydara FBX Binary"


@dataclass(frozen=True)
class ModelFacts:
    """预检**量到**的模型形态。

    通过时也返回它(而不是只返 None),理由与 ``MasterFacts`` 一样:数进进度文案,
    出问题(尤其是误拒)时一眼看得出当时把什么当成了身高、臂展、配件。
    """

    fmt: str
    size_bytes: int
    geometry_read: bool                       # False = 没读到几何,姿势/配件两条**没测**
    bbox: tuple[float, float, float] | None = None    # (x, y, z) 跨度
    arm_span_ratio: float | None = None       # max(x, z) / y
    mesh_nodes: int = 0
    named_parts: Sequence[str] = field(default_factory=tuple)

    def note(self) -> str:
        mb = self.size_bytes / 10**6
        if not self.geometry_read:
            return (f"{self.fmt} {mb:.1f}MB;未读几何 —— 姿势/配件两条未检,由调用方保证")
        assert self.bbox is not None
        x, y, z = self.bbox
        return (f"{self.fmt} {mb:.1f}MB;包围盒 {x:.3f}×{y:.3f}×{z:.3f},"
                f"臂展/身高 {self.arm_span_ratio:.2f},网格节点 {self.mesh_nodes}")


def sniff_format(model: bytes) -> str:
    """按 **magic bytes** 判容器格式。

    为什么不接受调用方声明的 ``fmt=``:嗅探零成本且**不可能与事实矛盾**,而一个参数可以
    填错;填错的后果是接口按错误格式解析,产出错结果而不是报错。这一条同时是
    :class:`ArtifactFormatError` 那个坑的另一半 —— 收产物时也用它复核供应商自述的 Type。
    """
    if model[:4] == _GLB_MAGIC:
        return "GLB"
    if model[:len(_FBX_MAGIC)] == _FBX_MAGIC:
        return "FBX"
    raise ModelRejected(
        ModelRejectCode.UNREADABLE,
        f"既不是 GLB(magic {_GLB_MAGIC!r})也不是二进制 FBX(magic {_FBX_MAGIC!r}),"
        f"头 8 字节是 {model[:8]!r};长度 {len(model)} 字节",
    )


# ── GLB 几何 ────────────────────────────────────────────────────────────────


def _glb_json(model: bytes) -> Mapping:
    """取 GLB 的 JSON 块。**不碰 BIN 块** —— 包围盒在 accessor 的 min/max 里白送。"""
    if len(model) < 12:
        raise ModelRejected(ModelRejectCode.UNREADABLE, f"GLB 只有 {len(model)} 字节,连头都不够")
    _, _, total = struct.unpack_from("<4sII", model, 0)
    if total > len(model):
        raise ModelRejected(
            ModelRejectCode.UNREADABLE,
            f"GLB 头声称 {total} 字节,实际只有 {len(model)} —— 文件被截断了",
        )
    off = 12
    while off + 8 <= total:
        clen, ctype = struct.unpack_from("<I4s", model, off)
        body = model[off + 8: off + 8 + clen]
        if ctype == b"JSON":
            try:
                return json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ModelRejected(
                    ModelRejectCode.UNREADABLE, f"GLB 的 JSON 块解不开:{exc}") from exc
        off += 8 + clen + (-clen % 4)
    raise ModelRejected(ModelRejectCode.UNREADABLE, "GLB 里没有 JSON 块")


def _node_matrix(node: Mapping) -> tuple[float, ...]:
    """节点的局部变换,列主序 4×4(与 glTF 的 ``matrix`` 同序)。

    必须算:accessor 的 min/max 是**网格局部空间**的,节点上挂着缩放时直接拿来比就错了
    (图生 3D 的产物常带一个整体缩放)。TRS 与 matrix 二选一,规范如此。
    """
    if "matrix" in node:
        return tuple(float(v) for v in node["matrix"])
    tx, ty, tz = node.get("translation", (0.0, 0.0, 0.0))
    qx, qy, qz, qw = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))
    # 四元数 → 3×3
    r = (
        1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
        2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
        2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy),
    )
    return (
        r[0] * sx, r[1] * sx, r[2] * sx, 0.0,
        r[3] * sy, r[4] * sy, r[5] * sy, 0.0,
        r[6] * sz, r[7] * sz, r[8] * sz, 0.0,
        tx, ty, tz, 1.0,
    )


def _mul(a: Sequence[float], b: Sequence[float]) -> tuple[float, ...]:
    """列主序 4×4 相乘,返回 a∘b(先应用 b,再应用 a)。"""
    out = []
    for col in range(4):
        for row in range(4):
            out.append(sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4)))
    return tuple(out)


def _apply(m: Sequence[float], p: Sequence[float]) -> tuple[float, float, float]:
    return (
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    )


_IDENTITY = (1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)


def read_glb_geometry(model: bytes) -> ModelFacts:
    """从 GLB 读包围盒 / 网格节点数 / 各处名字。只解 JSON 块,不解 BIN。"""
    doc = _glb_json(model)
    nodes = doc.get("nodes") or []
    meshes = doc.get("meshes") or []
    accessors = doc.get("accessors") or []
    materials = doc.get("materials") or []

    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    mesh_nodes = 0
    names: list[str] = []

    scene = (doc.get("scenes") or [{}])[doc.get("scene", 0)] if doc.get("scenes") else {}
    roots: Iterable[int] = scene.get("nodes") or range(len(nodes))

    stack = [(int(i), _IDENTITY) for i in roots]
    seen: set[int] = set()
    while stack:
        idx, parent = stack.pop()
        if idx in seen or idx >= len(nodes):      # 防环:坏文件里 children 自引会转死
            continue
        seen.add(idx)
        node = nodes[idx]
        world = _mul(parent, _node_matrix(node))
        for child in node.get("children") or []:
            stack.append((int(child), world))
        if "mesh" not in node:
            continue
        mesh_nodes += 1
        mesh = meshes[node["mesh"]] if node["mesh"] < len(meshes) else {}
        for label in (node.get("name"), mesh.get("name")):
            if label:
                names.append(str(label))
        for prim in mesh.get("primitives") or []:
            mat = prim.get("material")
            if mat is not None and mat < len(materials) and materials[mat].get("name"):
                names.append(str(materials[mat]["name"]))
            pos = (prim.get("attributes") or {}).get("POSITION")
            if pos is None or pos >= len(accessors):
                continue
            acc = accessors[pos]
            amin, amax = acc.get("min"), acc.get("max")
            if not (amin and amax and len(amin) == 3):
                continue
            # 变换后的包围盒 = 8 个角点变换后再取包围盒(有旋转时取 min/max 直接变换是错的)
            for cx in (amin[0], amax[0]):
                for cy in (amin[1], amax[1]):
                    for cz in (amin[2], amax[2]):
                        p = _apply(world, (float(cx), float(cy), float(cz)))
                        for k in range(3):
                            lo[k] = min(lo[k], p[k])
                            hi[k] = max(hi[k], p[k])

    if lo[0] == float("inf"):
        # 有 GLB 结构但读不到任何 POSITION 边界。不当成"通过",标成没测。
        return ModelFacts(fmt="GLB", size_bytes=len(model), geometry_read=False,
                          mesh_nodes=mesh_nodes, named_parts=tuple(names))

    bbox = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    height = bbox[1]
    ratio = (max(bbox[0], bbox[2]) / height) if height > 1e-9 else float("inf")
    return ModelFacts(fmt="GLB", size_bytes=len(model), geometry_read=True, bbox=bbox,
                      arm_span_ratio=ratio, mesh_nodes=mesh_nodes, named_parts=tuple(names))


# ── 闸 ──────────────────────────────────────────────────────────────────────


def check_model(
    model: bytes,
    *,
    max_bytes: int = MAX_UPLOAD_BYTES,
    arm_span_min: float = ARM_SPAN_MIN,
    arm_span_max: float = ARM_SPAN_MAX,
    check_pose: bool = True,
    check_accessories: bool = True,
) -> ModelFacts:
    """绑骨送检前的入口预检。通过返回量到的形态,不通过抛 :class:`ModelRejected`。

    ``check_pose`` / ``check_accessories`` 留成开关,不是为了方便跳过 —— 是因为这两条
    **都是近似判据**(一个单侧、一个弱信号),误拒的代价是挡住调用方一次合法的付费调用。
    关掉时后果由调用方承担,且 :attr:`ModelFacts.geometry_read` 仍如实记录量到了什么。
    """
    fmt = sniff_format(model)
    if len(model) > max_bytes:
        raise ModelRejected(
            ModelRejectCode.TOO_LARGE,
            f"{len(model) / 10**6:.1f}MB 超过接口上限 {max_bytes / 10**6:.0f}MB;"
            "先本地减面(decimate)再送绑骨 —— 超限不会报错,只会产出错结果",
        )
    if fmt != "GLB":
        # FBX:没有白送的包围盒,姿势/配件两条测不了。如实记成"没测",不冒充通过。
        return ModelFacts(fmt=fmt, size_bytes=len(model), geometry_read=False)

    facts = read_glb_geometry(model)
    if not facts.geometry_read:
        return facts

    if check_accessories:
        hit = [n for n in facts.named_parts if _TOKEN_RE.search(n)]
        if hit:
            raise ModelRejected(
                ModelRejectCode.HAS_ACCESSORY,
                f"网格/节点/材质名里有武器配件词:{hit};接口要求送检的是**去武器的身体档**"
                "(实测带剑的模型,剑会被绑上权重、动画里乱甩)。武器请绑完骨再作为刚体挂件挂到手骨。",
            )

    if check_pose:
        ratio = facts.arm_span_ratio
        assert ratio is not None
        if ratio < arm_span_min:
            raise ModelRejected(
                ModelRejectCode.NOT_A_POSE,
                f"臂展/身高 = {ratio:.2f},低于下限 {arm_span_min};手臂是贴着身体垂下的,"
                "不是 A-Pose 也不是 T-Pose。接口对非 A/T-Pose 不报错,只会绑出错骨架。",
            )
        if ratio > arm_span_max:
            raise ModelRejected(
                ModelRejectCode.NOT_A_POSE,
                f"臂展/身高 = {ratio:.2f},高于上限 {arm_span_max};人形 A/T-Pose 不会这么宽 —— "
                "多半是模型躺着或轴向约定不对(glTF 规范是 Y-up)。包围盒 "
                f"{facts.bbox[0]:.3f}×{facts.bbox[1]:.3f}×{facts.bbox[2]:.3f}。",
            )
    return facts
