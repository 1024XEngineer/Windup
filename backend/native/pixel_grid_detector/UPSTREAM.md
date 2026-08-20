# Upstream

检测算法源自 [Retro-Diffusion/pixel-art-fixer](https://github.com/Retro-Diffusion/pixel-art-fixer)，固定于提交 `ef376e57e1c272633ca2dbf5f29ec3fcf6596465`，使用 MIT License。

Windup 仅增加独立的 stdin/JSON 边界、输入资源限制、项目内测试与统一格式化；检测算法逻辑保持上游实现。

`tests/frog-500.png` 由同一固定提交的 MIT 示例 `examples/frog.png` 以 Lanczos 缩放至 500×500，用于覆盖完整检测器的仲裁路径。
