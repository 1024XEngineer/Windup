"""出帧 provider 的用例。

这一段**零 API 成本**,所以真出帧的用例可以放心跑(标 ``slow``,一条数秒)。
输入用本仓已有的绑骨产物 ``characters/oc_v4/rigged_despill.fbx`` —— 那笔钱早花过了。
"""
from __future__ import annotations

import pathlib

import numpy as np
import pytest
from PIL import Image
import io

from render3d_helpers import make_glb

from windup_framework.providers.render3d import (
    DIRECTIONS_4,
    DIRECTIONS_8,
    MATERIALS,
    LocalSpriteRenderProvider,
    ModelRejected,
    RenderStageError,
)


# ── 边界校验(不起浏览器) ────────────────────────────────────────────────────


def test_unknown_material_is_refused():
    """**仪器陷阱**:管线那份出帧台的材质分支只认三种取值,其余(含 cel / studio)静默落到
    同一个分支 —— 于是"拿两种材质做对照"实际根本没换材质,结论不作数。
    provider 在边界上校验,不给静默兜底留口子。"""
    p = LocalSpriteRenderProvider()
    with pytest.raises(ValueError, match="未知材质"):
        p.render(b"glTF\x00", material="studio")
    for good in MATERIALS:
        assert good in MATERIALS


def test_material_table_has_no_silent_aliases():
    """表里每个取值都必须对应出帧台里一个**显式分支**,而且出帧台没有兜底分支。

    第一版这条用例只 grep ``'toon'`` 在不在文件里 —— 结果把 toon 分支整行删掉它还是绿的
    (因为 MATERIALS 数组里也有 'toon' 这个字面量)。变异测试逮到的,现在改成查分支条件。
    """
    from windup_framework.providers.render3d.sprite import STAGE_DIR
    stage = (STAGE_DIR / "bake_stage.html").read_text()
    for m in MATERIALS:
        if m == "orig":
            assert "MAT !== 'orig'" in stage, "orig 应当整段跳过材质替换"
            continue
        assert f"MAT === '{m}'" in stage, f"出帧台里没有材质 {m} 的显式分支"
    assert "别静默兜底" in stage, "出帧台的材质三元表必须以抛错收尾,不能有 fall-through"
    # 白名单闸是**双保险**:provider 那道拦的是走 provider 的调用方,这道拦的是直接开页面的人
    # (调参数、做对照实验时最常这么干,也正是仪器陷阱当初发生的场合)。
    assert "MATERIALS.includes(MAT)" in stage, "出帧台自己也要拒认不出的材质,不能只靠 provider"


def test_framing_measures_bone_positions_not_mesh_bounds():
    """构图必须量**骨骼世界位置**,不能用 ``Box3.setFromObject`` 量 SkinnedMesh。

    机制:蒙皮变形在 GPU 上做,CPU 侧的几何顶点**从来不动**,所以 ``setFromObject``
    量出来永远是绑定姿态的盒子(症状:含跳跃在内的五个动作量出来高度全一样,跳跃腾空时
    头切出画面)。

    **这是一条白盒(结构)用例,不是行为用例 —— 为什么只能这样**:2026-08-11 实测,
    把实现换成 ``setFromObject`` 后,本仓唯一可用的绑骨产物(单条 walk 片段)渲出来
    占高只从 0.716–0.722 变成 0.728–0.738,差 1.5% 帧高。要用行为用例杀掉它就得把
    占高卡在 0.71–0.73 这么窄的窗里,那是对**这一个角色**过拟合,换个角色就误报。
    这个陷阱真正发威要靠大幅度动作(跳跃)的片段,而我们手上没有 —— 所以退一步锁机制,
    并把"没有行为用例覆盖"这件事写在这里,别让人以为已经守住了。
    """
    from windup_framework.providers.render3d.sprite import STAGE_DIR
    stage = (STAGE_DIR / "bake_stage.html").read_text()
    assert "setFromMatrixPosition(b.matrixWorld)" in stage
    assert "expandByScalar(0.10)" in stage, "骨骼是线、网格有厚度,余量不能省"


def test_direction_count_is_4_or_8():
    p = LocalSpriteRenderProvider()
    for bad in (1, 2, 6, 16):
        with pytest.raises(ValueError, match="4 或 8"):
            p.render(b"glTF\x00", directions=bad)


def test_eight_directions_are_a_superset_of_four():
    assert set(DIRECTIONS_4) < set(DIRECTIONS_8)
    for k, v in DIRECTIONS_4.items():
        assert DIRECTIONS_8[k] == v          # 同名朝向的方位角必须一致,否则 4/8 向对不齐


def test_direction_yaws_are_45_degree_steps():
    assert sorted(DIRECTIONS_8.values()) == [0, 45, 90, 135, 180, 225, 270, 315]


def test_frames_must_be_positive():
    with pytest.raises(ValueError, match="帧数"):
        LocalSpriteRenderProvider().render(b"glTF\x00", frames=0)


def test_garbage_model_is_refused_by_sniffing():
    with pytest.raises(ModelRejected):
        LocalSpriteRenderProvider().render(b"not a model at all")


def test_missing_three_is_a_readable_error(rigged_fbx):
    p = LocalSpriteRenderProvider(three_dir="/nonexistent/three")
    p._three = None
    with pytest.raises(RenderStageError, match="three.js"):
        p.render(rigged_fbx)


# ── 真出帧 ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def sheet(rigged_fbx):
    p = LocalSpriteRenderProvider()
    if p._three is None:
        pytest.skip("本机找不到 three.js(设 WINDUP_THREE_DIR)")
    return p.render(rigged_fbx, directions=4, frames=8, size=(512, 640), material="cel")


@pytest.mark.slow
def test_render_reports_the_established_rig_facts(sheet):
    """已确立的事实:自动绑骨产出 **28 骨**、humanoid 命名、**无 mixamorig: 前缀**。
    对不上说明拿到的不是这条链路的产物,该停下来看而不是接着渲。"""
    assert sheet.rig.bones == 28
    assert sheet.rig.skinned_meshes >= 1
    assert sheet.rig.loader == "fbx"
    assert sheet.rig.root_bone == "root"


@pytest.mark.slow
def test_preset_motion_has_zero_root_displacement(sheet):
    """48 个预设全部零根位移 —— 这里量的是出帧台从位置轨抽出来的实际位移。
    它不为 0 就说明拿到的不是绑骨预设动作(或抽取逻辑坏了)。"""
    assert sheet.root_motion is not None
    assert sheet.root_motion["total_span"] == 0


@pytest.mark.slow
def test_all_four_directions_come_out(sheet):
    assert [s.direction for s in sheet.sequences] == list(DIRECTIONS_4)
    assert [s.camera_yaw for s in sheet.sequences] == [0, 90, 180, 270]
    assert sheet.frame_count == 32
    for s in sheet.sequences:
        assert len(s.frames) == 8
        assert all(f[:8] == b"\x89PNG\r\n\x1a\n" for f in s.frames)   # 真 PNG,不是空串


@pytest.mark.slow
def test_frames_are_not_blank(sheet):
    """空帧自检的正面:每帧都得有实体像素。出帧台会在角色出画/片段选错时静默产出
    全透明帧,而外层照样打印"N 帧 时长…" —— 那次三帧 alpha 全 0,零告警。"""
    for s in sheet.sequences:
        for i, raw in enumerate(s.frames):
            alpha = np.asarray(Image.open(io.BytesIO(raw)).convert("RGBA"))[..., 3]
            solid = (alpha > 128).mean()
            assert 0.02 < solid < 0.6, f"{s.direction}/f{i} 实体占比 {solid:.4f} 不像个角色"


@pytest.mark.slow
def test_camera_yaw_actually_changes_the_image(sheet):
    """**先验仪器**:如果 camyaw 没生效,四个朝向会是同一张图,而"多朝向已跑通"就是假的。
    e(0°) 与 w(180°) 是对侧视角,应当接近**水平镜像**但不相等(角色左右不对称)。"""
    by = {s.direction: s for s in sheet.sequences}
    e = np.asarray(Image.open(io.BytesIO(by["e"].frames[0])).convert("RGBA")).astype(int)
    w = np.asarray(Image.open(io.BytesIO(by["w"].frames[0])).convert("RGBA")).astype(int)
    n = np.asarray(Image.open(io.BytesIO(by["n"].frames[0])).convert("RGBA")).astype(int)
    assert not np.array_equal(e, w) and not np.array_equal(e, n)
    mirrored = np.abs(e - w[:, ::-1, :]).mean()
    direct = np.abs(e - w).mean()
    assert mirrored < direct / 2, f"e 与 w 不成镜像关系(镜像差 {mirrored:.2f} vs 直接差 {direct:.2f})"


@pytest.mark.slow
def test_legs_alternate_across_the_walk_cycle(sheet):
    """步态判据看**腿有没有左右交替**,不看对齐指标 —— 逐帧图生图路线量不出这个差别
    (它出来的是踢踏舞:腿在动但不交替)。侧视剪影宽度在一个走路周期里应当出现两个峰。"""
    by = {s.direction: s for s in sheet.sequences}
    widths = []
    for raw in by["e"].frames:
        a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGBA"))[..., 3] > 128
        xs = np.where(a.any(axis=0))[0]
        widths.append(int(xs.max() - xs.min()))
    peaks = [i for i in range(len(widths))
             if widths[i] > widths[i - 1] and widths[i] > widths[(i + 1) % len(widths)]]
    assert len(peaks) == 2, f"侧视剪影宽度 {widths} 只有 {len(peaks)} 个峰,不像左右交替的步态"
    assert max(widths) - min(widths) > 0.3 * max(widths), f"跨度变化太小:{widths}"


@pytest.mark.slow
def test_framing_is_fixed_across_directions(sheet):
    """构图一次算定、跨朝向固定。各朝向的脚线(剪影底边)必须落在同一行 ——
    对不齐的话拼进同一张精灵表就会上下跳。"""
    bottoms = []
    for s in sheet.sequences:
        a = np.asarray(Image.open(io.BytesIO(s.frames[0])).convert("RGBA"))[..., 3] > 128
        rows, cols = np.where(a.any(axis=1))[0], np.where(a.any(axis=0))[0]
        bottoms.append(int(rows.max()))
        # 不贴边:贴到画幅边缘就说明取景把角色切了(跳跃切头就是这么发生的)。
        assert rows.min() > 0 and rows.max() < a.shape[0] - 1, f"{s.direction} 纵向被切"
        assert cols.min() > 0 and cols.max() < a.shape[1] - 1, f"{s.direction} 横向被切"
    assert max(bottoms) - min(bottoms) <= 4, f"各朝向脚线不齐:{bottoms}"


@pytest.mark.slow
def test_sampling_is_deterministic(rigged_fbx):
    """确定性取样(mixer.setTime,不靠实时播放):同一入参跑两次必须逐位一致。
    不一致就说明取样受实时时钟影响,那么任何"改了参数导致变化"的结论都不作数。"""
    p = LocalSpriteRenderProvider()
    if p._three is None:
        pytest.skip("本机找不到 three.js")
    kw = dict(directions=4, frames=2, size=(256, 320), material="cel")
    a = p.render(rigged_fbx, **kw)
    b = p.render(rigged_fbx, **kw)
    assert a.sample_times == b.sample_times
    for sa, sb in zip(a.sequences, b.sequences):
        assert tuple(sa.frames) == tuple(sb.frames), f"{sa.direction} 两次跑不一致"


@pytest.mark.slow
def test_blank_frame_gate_actually_fires(rigged_fbx):
    """把空帧阈值调到 0.999(没有哪帧能达到)→ 必须报错。

    这条用例验的是**闸门本身**,不是模型:一个从不触发的自检等于没有自检,
    而"空白冒充成功"正是这条线踩过的坑。
    """
    p = LocalSpriteRenderProvider(min_coverage=0.999)
    if p._three is None:
        pytest.skip("本机找不到 three.js")
    # 锚到 provider 自己那句,而不是 driver 打在 stderr 里的那句:只匹配 "空帧自检" 的话,
    # 把 returncode==2 那个分支整段删掉用例还是绿的(错误照样抛,只是变成一句
    # "出帧失败(退出码 2)" + 原文 stderr)—— 变异测试逮到的,诊断质量得单独锁住。
    with pytest.raises(RenderStageError, match="出帧台空帧自检不通过"):
        p.render(rigged_fbx, directions=4, frames=1, size=(256, 320))


@pytest.mark.slow
def test_unknown_clip_name_lists_what_exists(rigged_fbx):
    p = LocalSpriteRenderProvider()
    if p._three is None:
        pytest.skip("本机找不到 three.js")
    with pytest.raises(RenderStageError, match="没有片段"):
        p.render(rigged_fbx, clip="Walking", directions=4, frames=1, size=(256, 320))


# ── 依赖发现:纯本地路径逻辑,不需要真的出帧 ─────────────────────────────────


def test_three_discovery_survives_unstat_able_paths(monkeypatch, tmp_path):
    """向上搜 node_modules 会走到 /,那里有些合成入口对 stat 直接报错。

    问不出来必须当成"没有",否则整条发现逻辑连同所有依赖它的用例一起崩。
    """
    from windup_framework.providers.render3d import sprite

    class _Boom(pathlib.Path):
        def is_dir(self):
            raise OSError(22, "Invalid argument")

    monkeypatch.delenv("WINDUP_THREE_DIR", raising=False)
    assert sprite._is_dir(_Boom(tmp_path)) is False


def test_explicit_three_dir_wins_over_search(monkeypatch, tmp_path):
    """显式指定就不再搜 —— 搜索是兜底,不该覆盖调用方的明确意图。"""
    from windup_framework.providers.render3d import sprite

    monkeypatch.setenv("WINDUP_THREE_DIR", str(tmp_path / "my-three"))
    assert sprite._discover_three() == tmp_path / "my-three"


def test_missing_three_reports_how_to_fix():
    """找不到 three 要说清怎么办,不能只抛一句 None。"""
    from windup_framework.providers.render3d import (
        LocalSpriteRenderProvider,
        RenderStageError,
    )

    p = LocalSpriteRenderProvider(three_dir=None)
    p._three = None
    with pytest.raises(RenderStageError, match="three"):
        p.render(make_glb(), directions=4, frames=4)


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"directions": 3}, "朝向数"),
        ({"directions": 0}, "朝向数"),
        ({"material": "studio"}, "未知材质"),
        ({"frames": 0}, "帧数"),
    ],
)
def test_bad_arguments_are_refused_before_any_work(kwargs, match):
    """认不出的取值当场抛。

    材质那条尤其重要:有兜底分支的话拼错的名字会静默落到同一处,"换材质做对照"
    实际没换,而据此得出的结论不作数。
    """
    from windup_framework.providers.render3d import LocalSpriteRenderProvider

    call = {"directions": 4, "frames": 4, "material": "cel"}
    call.update(kwargs)
    with pytest.raises(ValueError, match=match):
        LocalSpriteRenderProvider().render(make_glb(), **call)


# ── 出帧台失败路径(不起浏览器:替掉 subprocess.run) ──────────────────────────
#
# 这些分支的共同点是**出帧已经跑过、但产物不可信**。它们必须抛错而不是往下走:
# 全透明帧 / 缺 meta 都能凑出一份"帧数对、无异常"的产物,而那正是本条线踩过的陷阱。


def _provider(tmp_path):
    """绕开 three.js 发现:这些用例测的是 node 子进程的返回,与 three 在不在无关。"""
    (tmp_path / "three").mkdir(exist_ok=True)
    return LocalSpriteRenderProvider(three_dir=tmp_path / "three")


class _Proc:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode, self.stdout, self.stderr = returncode, stdout, stderr


def _run_render(monkeypatch, tmp_path, fake_run):
    from windup_framework.providers.render3d import sprite as _sprite
    monkeypatch.setattr(_sprite.subprocess, "run", fake_run)
    return _provider(tmp_path).render(make_glb(), directions=4, frames=2)


def test_missing_node_says_which_binary_failed(monkeypatch, tmp_path):
    def _boom(*a, **k):
        raise FileNotFoundError("node")
    with pytest.raises(RenderStageError, match="起不来 node"):
        _run_render(monkeypatch, tmp_path, _boom)


def test_render_timeout_reports_the_budget(monkeypatch, tmp_path):
    import subprocess as _sp

    def _slow(*a, **k):
        raise _sp.TimeoutExpired(cmd="node", timeout=900)
    with pytest.raises(RenderStageError, match="出帧超时"):
        _run_render(monkeypatch, tmp_path, _slow)


def test_blank_frame_selftest_is_not_swallowed(monkeypatch, tmp_path):
    """退出码 2 = 出帧台自己判定全透明。**不能当成功**——三帧 alpha 全 0 时
    外层照样能打印"N 帧 时长…",没有任何告警,排查方向整个跑偏。"""
    def _blank(*a, **k):
        return _Proc(returncode=2, stderr="coverage 0.000 < 0.005")
    with pytest.raises(RenderStageError, match="空帧自检"):
        _run_render(monkeypatch, tmp_path, _blank)


def test_generic_failure_surfaces_the_exit_code_and_output(monkeypatch, tmp_path):
    def _fail(*a, **k):
        return _Proc(returncode=7, stderr="WebGL context lost")
    with pytest.raises(RenderStageError, match="退出码 7"):
        _run_render(monkeypatch, tmp_path, _fail)


def test_failure_without_stderr_falls_back_to_stdout(monkeypatch, tmp_path):
    """错误信息两头都可能空;两头都不看的话报错就成了一句"失败了"。"""
    def _fail(*a, **k):
        return _Proc(returncode=1, stderr="", stdout="loader threw")
    with pytest.raises(RenderStageError, match="loader threw"):
        _run_render(monkeypatch, tmp_path, _fail)


def test_success_without_meta_file_is_still_a_failure(monkeypatch, tmp_path):
    """退出码 0 但没写 bake_meta.json —— "没崩" 不等于 "出了帧"。"""
    def _ok(*a, **k):
        return _Proc(returncode=0, stdout="done")
    with pytest.raises(RenderStageError, match="bake_meta.json"):
        _run_render(monkeypatch, tmp_path, _ok)


def test_a_direction_with_no_frames_names_the_direction(monkeypatch, tmp_path):
    """meta 写了、帧目录空。报出**是哪个朝向**缺帧,否则只能去翻临时目录。"""
    import json as _json

    def _ok_but_empty(*a, **k):
        out = pathlib.Path(k["env"]["OUT"])
        (out / "bake_meta.json").write_text(_json.dumps({"clip": "idle"}))
        return _Proc(returncode=0)
    with pytest.raises(RenderStageError, match="一帧都没出"):
        _run_render(monkeypatch, tmp_path, _ok_but_empty)


def test_driver_uses_bundled_chromium_not_branded_chrome():
    """出帧台不得要求品牌版 Chrome。

    ``channel: 'chrome'`` 在装了 Chrome 的开发机上能跑,在容器镜像里起不来
    (playwright 只带 chromium),于是整个渲帧段无法部署。也不接受"先试 chrome
    再退回 chromium"的链:出帧结果依赖具体浏览器,静默换一个等于同一份模型在
    不同机器上出不同的帧。
    """
    from windup_framework.providers.render3d.sprite import STAGE_DIR

    # 只看代码行:注释里提到 channel 是在解释为什么不用它。
    code = [ln for ln in (STAGE_DIR / "bake_driver.mjs").read_text(encoding="utf-8").splitlines()
            if not ln.lstrip().startswith(("//", "*", "/*"))]
    launch = [ln for ln in code if "chromium.launch" in ln]
    assert launch, "找不到浏览器启动这一行,断言会空跑成绿的"
    assert "channel" not in "".join(launch), f"指定了浏览器 channel,容器里会起不来:{launch}"
