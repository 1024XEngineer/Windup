# gac — Windup 架构空骨架

MS1 架构主干（对应 Issue #3）：模块划分 + 接口契约 + 数据模型，接口为真、实现桩空、可编译、主干串联可空跑（数据 mock）。

- `models.py` 领域数据模型
- `interfaces.py` 模块对外接口契约
- `generation/` `lastmile/` `packaging.py` `export/` `assetstore.py` `evaluation.py` 各模块（桩）
- `pipeline.py` 编排器（串联主干）
- `stubs.py` 默认装配；`../smoke.py` 冒烟串联（可打 tag v0.1.0-ms1）

真实现留 MS2 逐模块 PR 填。
