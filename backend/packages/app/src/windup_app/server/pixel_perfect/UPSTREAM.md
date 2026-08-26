# Upstream

两阶段重建与 deterministic k-means 逻辑源自
[Retro-Diffusion/pixel-art-fixer](https://github.com/Retro-Diffusion/pixel-art-fixer)，
固定于提交 `ef376e57e1c272633ca2dbf5f29ec3fcf6596465`，使用 MIT License。

本目录将既有 Rust 重建器等价迁移为 NumPy/Pillow 服务端实现。迁移保留
60,000 点确定性采样、固定种子 k-means++、Lloyd 迭代、两阶段结构投票、
原色恢复与透明度多数票；同色点去重与规则网格缓存只减少重复计算。
