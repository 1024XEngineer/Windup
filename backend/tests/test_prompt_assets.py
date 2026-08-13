"""提示词 markdown 资产的加载契约(#233)。

这一片锁的是一个具体的失败形态,不是"文件能读到":
**md 没打进 wheel → 提示词变空串 → 付费 i2v 调用照常发出 → 产出垃圾 → 任务显示成功。**
帧数、时长、成色全部正常,没有任何一道会红。所以缺文件 / 缺节 / 空节都必须当场抛错。
"""
from __future__ import annotations

import shutil
import subprocess
import zipfile

import pytest

from windup_ai_engine.master_prep import MASTER_POSES
from windup_ai_engine.prompt import (
    build_attack_prompt,
    build_idle_prompt,
    build_jump_prompt,
    build_walk_prompt,
)
from windup_ai_engine.prompt._md import PromptAssetError, load_doc, load_section

BUILDERS = {
    "walk": build_walk_prompt,
    "jump": build_jump_prompt,
    "idle": build_idle_prompt,
    "attack": build_attack_prompt,
}


# ── ① 缺失 / 空 必须当场抛错,不返回空串 ──────────────────────────────────


def test_missing_document_raises_with_where_to_look():
    with pytest.raises(PromptAssetError) as e:
        load_doc("no_such_action.md")
    assert "windup_ai_engine.prompt.prompts" in str(e.value), "报错没说去哪找"


def test_missing_section_lists_what_is_available():
    with pytest.raises(PromptAssetError) as e:
        load_section("walk.md", "sideways")
    assert "side" in str(e.value) and "front" in str(e.value)


def _inline(monkeypatch, tmp_path, text: str):
    """让加载器去读一份临时 md,并绕开 lru_cache(它按文件名缓存,会串用例)。"""
    from windup_ai_engine.prompt import _md

    doc = tmp_path / "inline.md"
    doc.write_text(text, encoding="utf-8")
    monkeypatch.setattr(_md, "load_doc", _md.load_doc.__wrapped__)
    monkeypatch.setattr(
        _md, "resources",
        type("_R", (), {"files": staticmethod(
            lambda pkg: type("_F", (), {"joinpath": staticmethod(lambda n: doc)})()
        )}),
    )
    return _md


def test_empty_section_raises_instead_of_returning_an_empty_prompt(tmp_path, monkeypatch):
    """空节 → 抛错。这是本文件存在的首要理由:空提示词会照常发出付费调用。"""
    md = _inline(monkeypatch, tmp_path,
                 "# 理由写在这\n\n## side\n\n## front\n\nreal text here\n")
    with pytest.raises(PromptAssetError, match="是空的"):
        md.load_section("inline.md", "side")
    assert md.load_section("inline.md", "front") == "real text here"


def test_empty_section_is_allowed_only_when_asked_for(tmp_path, monkeypatch):
    md = _inline(monkeypatch, tmp_path, "## walk\n\n## jump\n\nsomething\n")
    assert md.load_section("inline.md", "walk", allow_empty=True) == ""


def test_document_without_any_section_raises(tmp_path, monkeypatch):
    """只有散文、没有 `## 节` 的文件要炸 —— 否则每个朝向都查不到,退化成缺节报错,
    而真正的病因(文件结构写错了)被埋掉。"""
    md = _inline(monkeypatch, tmp_path, "# 只有理由,忘了写节\n\n随便一段散文。\n")
    with pytest.raises(PromptAssetError, match="一个 `## <节名>` 都没有"):
        md.load_doc("inline.md")


def test_rationale_quote_lines_are_not_part_of_the_prompt(tmp_path, monkeypatch):
    """`> ` 引用行是留给写理由的,不进正文。"""
    md = _inline(monkeypatch, tmp_path,
                 "## side\n\n> 这行是给人看的\nactual prompt text\n")
    assert md.load_section("inline.md", "side") == "actual prompt text"


# ── ② 每个动作的每个朝向都真的有内容 ─────────────────────────────────────


@pytest.mark.parametrize("action", sorted(BUILDERS))
@pytest.mark.parametrize("facing", ["side", "front"])
def test_every_action_document_has_both_facings(action: str, facing: str):
    text = BUILDERS[action](facing)
    assert text and len(text) > 80, f"{action}.{facing} 的提示词短得不像正文:{text!r}"


@pytest.mark.parametrize("action", sorted(BUILDERS))
def test_prose_before_the_sections_never_leaks_into_the_prompt(action: str):
    """节外的实测理由是写给人看的,一个字都不该混进送去生成的文本。"""
    for facing in ("side", "front"):
        text = BUILDERS[action](facing)
        assert "#" not in text, f"{action}.{facing} 混进了 markdown 标题"
        assert "实测" not in text and "母版" not in text, f"{action}.{facing} 混进了中文理由"


def test_illegal_facing_raises_instead_of_falling_back_to_front():
    """非法朝向要炸。静默落到 front 会拿到一段正面走的视频而没有任何报错。"""
    for build in BUILDERS.values():
        with pytest.raises(ValueError):
            build("sidee")


# ── ③ MASTER_POSES:空是有意义的,但只有它允许 ────────────────────────────


def test_master_poses_keeps_its_intentional_blanks():
    assert MASTER_POSES["walk"] == "" and MASTER_POSES["run"] == ""
    assert MASTER_POSES["idle"] == ""
    assert "deep crouch" in MASTER_POSES["jump"]
    assert "wind-up" in MASTER_POSES["attack"]


def test_only_master_poses_may_be_empty():
    """``allow_empty`` 是给"空本身有含义"的地方开的口子,别的提示词不许走这条。"""
    for action in BUILDERS:
        for facing in ("side", "front"):
            assert load_section(f"{action}.md", facing), f"{action}.{facing} 空了"


# ── ④ 打包:md 必须真的进 wheel,不能只在源码树里存在 ─────────────────────


def test_markdown_assets_are_shipped_in_the_wheel(tmp_path):
    """从**构建出来的 wheel** 里读,而不是从源码树读。

    这条是 #233 的验收之一,而且不是形式主义:源码树里能读到不代表装出来能读到,
    "装出来读不到"正是本文件开头那个失败形态的触发条件(提示词变空串 → 付费调用照发)。
    hatchling 目前默认收 packages 目录下的全部文件,所以 pyproject 不用额外配 —— 但
    "默认行为"正是会被将来某次配置调整悄悄改掉的东西,故用测试钉住,而不是写句注释。
    """
    if shutil.which("uv") is None:
        pytest.skip("本机没有 uv,构建不了 wheel")
    r = subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(tmp_path)],
        cwd="packages/ai_engine", capture_output=True, text=True,
    )
    assert r.returncode == 0, f"wheel 构建失败:{r.stderr[-500:]}"
    wheels = sorted(tmp_path.glob("*.whl"))
    assert wheels, "没产出 wheel"
    names = set(zipfile.ZipFile(wheels[-1]).namelist())
    for md in ("walk.md", "jump.md", "idle.md", "attack.md", "master_poses.md"):
        assert f"windup_ai_engine/prompt/prompts/{md}" in names, f"{md} 没进 wheel"
