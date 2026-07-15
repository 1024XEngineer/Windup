"""Godot 导出（P1 第二靶 / 工程受阻退路）。MS1 桩。"""
from __future__ import annotations
from ..models import DeliveryPackage


class GodotExporter:
    target = "godot"

    def export(self, pkg: DeliveryPackage, out_dir: str) -> list[str]:
        pkg.engine_native_path = f"{out_dir}/character.tres"
        return [p for p in (pkg.sheet_path, pkg.json_meta_path,
                            pkg.engine_native_path) if p]
