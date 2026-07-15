"""Cocos 原生导出（首靶）。MS1 桩：返回 mock 落地文件；MS2 生成真图集/SpriteFrame/.anim。"""
from __future__ import annotations
from ..models import DeliveryPackage


class CocosExporter:
    target = "cocos"

    def export(self, pkg: DeliveryPackage, out_dir: str) -> list[str]:
        pkg.engine_native_path = f"{out_dir}/character.anim"
        return [p for p in (pkg.sheet_path, pkg.json_meta_path,
                            pkg.engine_native_path) if p]
