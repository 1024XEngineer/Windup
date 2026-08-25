"""发版闸口。

发版逻辑写错的代价不是一次红 CI,是一个指向错误提交的 tag —— 而部署只认 Release。
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "version_gate", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "version_gate.py"
)
vg = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(vg)

TAGS = ["v0.1.0", "v0.9.9", "v0.10.0", "v0.32.0", "v0.32.1"]


def test_latest_release_compares_numerically_not_as_text():
    """0.10.0 比 0.9.9 新。按字符串比会反过来,而那正好是发版会踩的形态。"""
    assert vg.latest_release(["v0.9.9", "v0.10.0"]) == (0, 10, 0)


def test_unparseable_tags_are_ignored_not_guessed():
    assert vg.latest_release(["v1.0.0", "nightly", "v2026-08-25", "release-2"]) == (1, 0, 0)


def test_no_tags_at_all_still_releases():
    d = vg.decide("0.1.0", [])
    assert d["release"] and d["tag"] == "v0.1.0" and d["prev"] == ""


@pytest.mark.parametrize("bad", ["v1.2.3", "1.2", "1.2.3.4", "01.2.3", "1.2.3-rc1", "", "abc"])
def test_rejects_anything_that_is_not_bare_semver(bad):
    """``v1.2.3`` 也拒:tag 名由这里加 v 前缀,宽容接受会打出 vv1.2.3,而 tag 名是部署的寻址方式。"""
    with pytest.raises(vg.VersionError):
        vg.parse(bad)


def test_unchanged_version_is_not_an_error_it_is_just_no_release():
    d = vg.decide("0.32.1", TAGS)
    assert d["release"] is False and d["reason"] == "VERSION 未变更"


def test_bumped_version_releases_and_reports_the_previous_tag():
    d = vg.decide("0.33.0", TAGS)
    assert d["release"] is True and d["tag"] == "v0.33.0" and d["prev"] == "v0.32.1"


def test_lowering_the_version_is_rejected_rather_than_silently_skipped():
    """静默跳过会让「我改了版本号但没发版」变成一个没人发现的状态。"""
    with pytest.raises(vg.VersionError, match="低于已发布"):
        vg.decide("0.30.0", TAGS)


def test_trailing_whitespace_and_newline_are_tolerated():
    assert vg.decide("0.33.0\n", TAGS)["tag"] == "v0.33.0"


def test_major_bump_is_accepted():
    assert vg.decide("1.0.0", TAGS)["tag"] == "v1.0.0"


def test_repo_version_file_is_valid_and_not_behind_any_shipped_tag():
    """钉住仓库里真实的那份 VERSION —— 它非法或落后时,该在 PR 阶段就红。"""
    root = pathlib.Path(__file__).resolve().parents[1]
    text = (root / "VERSION").read_text(encoding="utf-8")
    vg.parse(text)                       # 非法即抛
    assert vg.decide(text, ["v" + text.strip()])["release"] is False


def test_unchanged_version_passes_even_when_main_has_released_ahead():
    """PR 开着期间 main 发了新版,这个 PR 不该因此变红 —— 它一个字都没改。

    这条是被真实 CI 教出来的:2026-08-25 本改造的 PR 挂着时 main 自动发了 v0.32.2,
    闸口把「VERSION 落后于最新 tag」判成了错误。
    """
    r = vg.check("0.32.1", TAGS + ["v0.32.2"], previous="0.32.1")
    assert r["changed"] is False


def test_changing_the_version_downwards_is_still_rejected():
    with pytest.raises(vg.VersionError, match="低于已发布"):
        vg.check("0.30.0", TAGS, previous="0.32.1")


def test_changing_the_version_upwards_passes():
    assert vg.check("0.33.0", TAGS, previous="0.32.1")["changed"] is True


def test_no_previous_given_falls_back_to_comparing_against_tags():
    """基点上还没有 VERSION 文件时(引入这套机制的那个 PR),仍按 tag 比。"""
    with pytest.raises(vg.VersionError):
        vg.check("0.30.0", TAGS, previous=None)


def test_malformed_version_is_rejected_even_when_unchanged():
    """格式永远校验:一个坏值不会因为「没人动过它」而变得可接受。"""
    with pytest.raises(vg.VersionError):
        vg.check("not-a-version", TAGS, previous="not-a-version")


def test_check_mode_exits_nonzero_on_a_bad_version(tmp_path, monkeypatch):
    p = tmp_path / "VERSION"
    p.write_text("not-a-version")
    monkeypatch.setattr(vg, "_tags", lambda: TAGS)
    assert vg.main(["check", str(p)]) == 1


def test_decide_mode_emits_github_output_lines(tmp_path, monkeypatch, capsys):
    """workflow 直接把这几行 tee 进 $GITHUB_OUTPUT,格式错了就是一个空的 output。"""
    p = tmp_path / "VERSION"
    p.write_text("0.33.0\n")
    monkeypatch.setattr(vg, "_tags", lambda: TAGS)
    assert vg.main(["decide", str(p)]) == 0
    got = dict(line.split("=", 1) for line in capsys.readouterr().out.splitlines() if line)
    assert got["go"] == "true"
    assert got["next"] == "v0.33.0"
    assert got["prev"] == "v0.32.1"
    assert got["range"] == "v0.32.1..HEAD"


def test_decide_mode_on_an_unchanged_version_says_go_false_with_no_range(tmp_path, monkeypatch, capsys):
    p = tmp_path / "VERSION"
    p.write_text("0.32.1")
    monkeypatch.setattr(vg, "_tags", lambda: TAGS)
    vg.main(["decide", str(p)])
    got = dict(line.split("=", 1) for line in capsys.readouterr().out.splitlines() if line)
    assert got["go"] == "false"
