"""主干串联冒烟测试：跑通 pipeline 全链、产出非空交付文件。"""
from gac.models import Project, CharacterCard
from gac.stubs import build_default_pipeline


def test_pipeline_smoke():
    card = CharacterCard("骷髅剑士", "骨白暗红", "瘦高", "2.5头身",
                         "hand-drawn", ["mock/ref.png"])
    files = build_default_pipeline().run(
        Project("t"), card, ["idle", "walk", "attack"], "out")
    assert files and all(files)
