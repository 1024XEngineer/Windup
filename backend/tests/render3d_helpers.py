"""三渲二测试用的 GLB 构造器(随 provider3d 一起迁入)。"""
from __future__ import annotations

import json
import struct


def make_glb(
    bbox_min=(-0.35, 0.0, -0.14),
    bbox_max=(0.35, 1.0, 0.14),
    *,
    mesh_name: str = "body",
    node_name: str = "character",
    material_name: str = "skin",
    scale: tuple[float, float, float] | None = None,
    extra_mesh: tuple[str, tuple, tuple] | None = None,
    pad: int = 0,
) -> bytes:
    """造一个**只有 JSON 块**是真的 GLB。

    ``check_model`` 只读 JSON 块里 accessor 的 min/max(包围盒在 glTF 里是白送的),
    所以 BIN 块不需要有真顶点 —— 这让边界用例可以随手造,不必真去生成网格。
    ``pad`` 用来把文件撑大以测体积闸。
    """
    nodes = [{"name": node_name, "mesh": 0}]
    if scale:
        nodes[0]["scale"] = list(scale)
    meshes = [{"name": mesh_name, "primitives": [{"attributes": {"POSITION": 0}, "material": 0}]}]
    accessors = [{"type": "VEC3", "componentType": 5126, "count": 8,
                  "min": list(bbox_min), "max": list(bbox_max)}]
    materials = [{"name": material_name}]
    if extra_mesh:
        name, emin, emax = extra_mesh
        nodes.append({"name": name, "mesh": 1})
        meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": 1}, "material": 1}]})
        accessors.append({"type": "VEC3", "componentType": 5126, "count": 8,
                          "min": list(emin), "max": list(emax)})
        materials.append({"name": f"{name}_mat"})

    doc = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": meshes, "accessors": accessors, "materials": materials,
    }
    payload = json.dumps(doc).encode()
    payload += b" " * (-len(payload) % 4)
    binchunk = b"\x00" * (pad + (-pad % 4))
    total = 12 + 8 + len(payload) + (8 + len(binchunk) if binchunk else 0)
    out = struct.pack("<4sII", b"glTF", 2, total)
    out += struct.pack("<I4s", len(payload), b"JSON") + payload
    if binchunk:
        out += struct.pack("<I4s", len(binchunk), b"BIN\x00") + binchunk
    return out
