"""首个可串联版本 · 空跑冒烟：证明主干串联成立（数据 mock，无真实行为）。
运行：在仓库根目录执行 python3 smoke.py"""
from __future__ import annotations
from gac.models import Project, CharacterCard
from gac.stubs import build_default_pipeline


def main() -> None:
    card = CharacterCard(
        appearance="手绘风骷髅剑士", palette="骨白 + 暗红", body_type="瘦高",
        proportion="2.5 头身", style_anchor="hand-drawn",
        ref_image_paths=["mock/ref.png"])
    pipe = build_default_pipeline()
    files = pipe.run(Project(name="demo"), card,
                     ["idle", "walk", "attack"], "out")
    print("串联产出交付文件：")
    for f in files:
        print("  -", f)
    assert files, "pipeline 未产出文件"
    print("OK：首个可串联版本空跑通过（可打 tag v0.1.0-ms1）")


if __name__ == "__main__":
    main()
