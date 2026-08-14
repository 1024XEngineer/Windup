"""入口预检的用例。

每条都对着一个具体的失败形态,而不是"覆盖率"。重点是那三条**违反了接口不报错、
只默默出错结果**的硬约束 —— 它们只能在这一层被拦住。
"""
from __future__ import annotations

import pytest

from windup_framework.providers.render3d import ModelRejectCode, ModelRejected, check_model, sniff_format
from windup_framework.providers.render3d.checks import ARM_SPAN_MAX, ARM_SPAN_MIN, MAX_UPLOAD_BYTES, read_glb_geometry

from render3d_helpers import make_glb


# ── 格式嗅探 ────────────────────────────────────────────────────────────────


def test_sniff_glb_and_fbx(decimated_glb, rigged_fbx):
    assert sniff_format(decimated_glb) == "GLB"
    assert sniff_format(rigged_fbx) == "FBX"


def test_sniff_rejects_garbage():
    with pytest.raises(ModelRejected) as e:
        sniff_format(b"PK\x03\x04this is a zip")
    assert e.value.code == ModelRejectCode.UNREADABLE


def test_sniff_rejects_obj_zip_masquerading():
    """踩过的坑:一次任务返回多个格式,取到 OBJ 的 zip 被按 .glb 存下。
    嗅探必须认出它不是 GLB —— 那一次是靠 Blender 报 "Bad glTF" 才发现的。"""
    with pytest.raises(ModelRejected):
        sniff_format(b"PK\x03\x04" + b"\x00" * 100)


# ── 体积 ────────────────────────────────────────────────────────────────────


def test_real_decimated_glb_passes(decimated_glb):
    """已知良品控制样本:这份档真的送进绑骨并成功了。它必须过检 ——
    过不了说明闸门定错了,而不是模型有问题(先验仪器)。"""
    facts = check_model(decimated_glb)
    assert facts.fmt == "GLB"
    assert facts.geometry_read
    assert facts.mesh_nodes == 1
    assert 0.70 < facts.arm_span_ratio < 0.73        # 实测 0.715
    assert ARM_SPAN_MIN < facts.arm_span_ratio < ARM_SPAN_MAX


def test_oversize_is_rejected():
    big = make_glb(pad=MAX_UPLOAD_BYTES + 1000)
    assert len(big) > MAX_UPLOAD_BYTES
    with pytest.raises(ModelRejected) as e:
        check_model(big)
    assert e.value.code == ModelRejectCode.TOO_LARGE
    assert "decimate" in e.value.message           # 错误里要写清怎么修


def test_size_limit_is_10e6_not_2e20():
    """60MB 按 10^6 算(取小的那个口径)。刚好落在两种口径之间的档必须被拒 ——
    宁可多拒 4.7%,也不要送上去以后默默产出错结果。"""
    between = 60 * 10**6 + 5000                     # < 60*2^20,> 60*10^6
    assert between < 60 * 2**20
    with pytest.raises(ModelRejected):
        check_model(make_glb(pad=between))


def test_size_checked_before_geometry():
    """超大且几何也坏的档,报的必须是体积 —— 体积是精确判据,几何是近似判据,
    先报精确的那条,免得把人引去改姿势。"""
    huge_and_narrow = make_glb((-0.05, 0.0, -0.05), (0.05, 1.0, 0.05),
                               pad=MAX_UPLOAD_BYTES + 1000)
    with pytest.raises(ModelRejected) as e:
        check_model(huge_and_narrow)
    assert e.value.code == ModelRejectCode.TOO_LARGE


# ── 姿势(单侧近似) ────────────────────────────────────────────────────────


def test_arms_down_is_rejected():
    """手臂贴身垂下(臂展≈肩宽 0.24H):明显不是 A/T-Pose。

    注意判据是 ``max(X, Z) / Y`` —— 横向取两条水平轴里大的那条,因为角色朝向未知。
    所以造用例时进深也得压窄,否则量到的是进深而不是臂展(第一版用例就栽在这儿)。
    """
    with pytest.raises(ModelRejected) as e:
        check_model(make_glb((-0.12, 0.0, -0.05), (0.12, 1.0, 0.05)))
    assert e.value.code == ModelRejectCode.NOT_A_POSE
    assert "0.24" in e.value.message                # 量到的数要写在错误里,便于反查误拒


def test_t_pose_passes():
    """T-Pose 臂展 ≈ 身高,必须过。"""
    facts = check_model(make_glb((-0.5, 0.0, -0.14), (0.5, 1.0, 0.14)))
    assert facts.arm_span_ratio == pytest.approx(1.0)


def test_lying_down_or_wrong_axis_is_rejected():
    """身高被放到 Z 轴上(从 Z-up 工具导出):臂展/身高 冲到 3 以上。
    这一条挡的是坐标系错了,后果与姿势错一样 —— 照样扣积分、照样出错结果。"""
    with pytest.raises(ModelRejected) as e:
        check_model(make_glb((-0.35, 0.0, 0.0), (0.35, 0.30, 1.0)))
    assert e.value.code == ModelRejectCode.NOT_A_POSE
    assert "Y-up" in e.value.message


def test_pose_check_can_be_waived_but_facts_still_measured():
    facts = check_model(make_glb((-0.12, 0.0, -0.05), (0.12, 1.0, 0.05)), check_pose=False)
    assert facts.geometry_read
    assert facts.arm_span_ratio == pytest.approx(0.24)


def test_depth_counts_as_horizontal_span():
    """横向判据取 ``max(X, Z)``:角色可能朝 X 也可能朝 Z,不能只看一条轴。
    一个"臂展窄但进深宽"的档不该按 0.24 判 —— 它量出来是 0.60。"""
    facts = check_model(make_glb((-0.12, 0.0, -0.30), (0.12, 1.0, 0.30)))
    assert facts.arm_span_ratio == pytest.approx(0.60)


def test_node_scale_is_applied():
    """节点上挂着非等比缩放时必须先变换再量 —— accessor 的 min/max 是**网格局部空间**的。
    不乘节点矩阵的话,一个被压扁到不成人形的档会顶着"看起来正常"的比例过检。"""
    raw = make_glb((-0.35, 0.0, -0.05), (0.35, 1.0, 0.05))
    squashed = make_glb((-0.35, 0.0, -0.05), (0.35, 1.0, 0.05), scale=(0.2, 1.0, 1.0))
    assert read_glb_geometry(raw).arm_span_ratio == pytest.approx(0.70, abs=0.01)
    assert read_glb_geometry(squashed).arm_span_ratio == pytest.approx(0.14, abs=0.01)
    with pytest.raises(ModelRejected):
        check_model(squashed)


# ── 配件(弱信号) ──────────────────────────────────────────────────────────


def test_weapon_named_mesh_is_rejected():
    """实测:送入带剑的模型后,剑被错误绑上权重、动画里到处乱甩 —— 任务"成功"、积分照扣。"""
    with pytest.raises(ModelRejected) as e:
        check_model(make_glb(extra_mesh=("sword_01", (0.3, 0.4, -0.02), (0.36, 1.2, 0.02))))
    assert e.value.code == ModelRejectCode.HAS_ACCESSORY
    assert "sword_01" in e.value.message


def test_weapon_token_matches_chinese_and_case():
    for name in ("Blade_L", "长剑", "武器挂点"):
        with pytest.raises(ModelRejected) as e:
            check_model(make_glb(extra_mesh=(name, (0.3, 0.4, -0.02), (0.36, 1.2, 0.02))))
        assert e.value.code == ModelRejectCode.HAS_ACCESSORY


def test_extra_mesh_without_weapon_name_passes_but_is_reported():
    """多一块网格**不**构成拒绝(头发/眼睛常单独成网格,误拒代价是挡掉合法调用),
    但要如实记进 facts,让人能自己判断。"""
    facts = check_model(make_glb(extra_mesh=("hair", (-0.2, 0.8, -0.2), (0.2, 1.0, 0.2))))
    assert facts.mesh_nodes == 2
    assert "hair" in facts.named_parts


def test_merged_weapon_is_not_detectable():
    """**明确记下这一条测不了**:图生 3D 出的是单块网格,母版图里画了剑就和身体焊在
    同一个 mesh 里,没有独立节点也没有独立材质名 —— 本层一个信号都没有。
    这个用例存在的意义是:哪天有人以为预检守住了配件这条,能被它提醒。"""
    facts = check_model(make_glb((-0.45, 0.0, -0.14), (0.45, 1.0, 0.14),
                                 mesh_name="mesh", material_name="material"))
    assert facts.mesh_nodes == 1
    assert facts.named_parts == ("character", "mesh", "material")


# ── 读不动的输入 ────────────────────────────────────────────────────────────


def test_truncated_glb_is_rejected():
    whole = make_glb()
    with pytest.raises(ModelRejected) as e:
        check_model(whole[: len(whole) // 2])
    assert e.value.code == ModelRejectCode.UNREADABLE
    assert "截断" in e.value.message


def test_fbx_reports_geometry_not_read(rigged_fbx):
    """FBX 没有白送的包围盒 —— 姿势/配件两条**测不了**。
    必须如实记成 geometry_read=False,不能冒充通过。"""
    facts = check_model(rigged_fbx)
    assert facts.fmt == "FBX"
    assert facts.geometry_read is False
    assert facts.arm_span_ratio is None
    assert "未检" in facts.note()


def test_glb_without_position_bounds_reports_not_read():
    """有 GLB 结构但 accessor 没写 min/max(规范允许):同样标成没测,不当通过。"""
    import json
    import struct
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
           "nodes": [{"mesh": 0}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
           "accessors": [{"type": "VEC3", "componentType": 5126, "count": 8}]}
    payload = json.dumps(doc).encode()
    payload += b" " * (-len(payload) % 4)
    blob = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(payload))
    blob += struct.pack("<I4s", len(payload), b"JSON") + payload
    facts = check_model(blob)
    assert facts.geometry_read is False


def test_cyclic_children_do_not_hang():
    """坏文件里 children 自引不能把预检转死 —— 预检是入口闸,挂在这儿等于整条链路挂了。"""
    import json
    import struct
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
           "nodes": [{"children": [1]}, {"children": [0], "mesh": 0}],
           "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
           "accessors": [{"type": "VEC3", "componentType": 5126,
                          "count": 8, "min": [-0.35, 0, -0.14], "max": [0.35, 1, 0.14]}]}
    payload = json.dumps(doc).encode()
    payload += b" " * (-len(payload) % 4)
    blob = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(payload))
    blob += struct.pack("<I4s", len(payload), b"JSON") + payload
    assert check_model(blob).geometry_read
