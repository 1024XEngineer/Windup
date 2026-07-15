"""默认装配：用各模块的 MS1 桩实现拼出一条可空跑的主干。"""
from __future__ import annotations
from .pipeline import Pipeline
from .generation.route_a_refimg import RouteARefImgGenerator
from .lastmile.matting import RembgMatter
from .lastmile.alignment import FootlineAligner
from .lastmile.loop import SeamlessLoopCloser
from .packaging import GridPackager
from .export.cocos import CocosExporter
from .assetstore import InMemoryAssetStore


def build_default_pipeline() -> Pipeline:
    return Pipeline(
        gen=RouteARefImgGenerator(),
        matter=RembgMatter(),
        aligner=FootlineAligner(),
        loop=SeamlessLoopCloser(),
        packager=GridPackager(),
        exporter=CocosExporter(),
        store=InMemoryAssetStore(),
    )
