# Upstream

两阶段重建与 deterministic k-means 逻辑源自 [Retro-Diffusion/pixel-art-fixer](https://github.com/Retro-Diffusion/pixel-art-fixer)，固定于提交 `ef376e57e1c272633ca2dbf5f29ec3fcf6596465`，使用 MIT License。

Windup 将显式规则网格重建提取为独立 library，删除检测、旧重建器和未使用的量化路径，并修复密集网格下负三角权重造成颜色外插的问题。
