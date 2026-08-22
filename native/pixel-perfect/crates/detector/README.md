# Pixel grid detector

Windup 的独立本地像素网格识别库。它只读取 PNG/JPEG 字节并返回网格元数据，不负责重建图片，也不引用任何生成管线或应用服务。

默认执行 Pixel Art Fixer 的完整多检测器共识流程：autocorrelation、run-length comb、shift self-similarity 与证据仲裁。调用方可以显式选择 `DetectorMode::Fast` 作为低延迟模式。

```bash
cargo test --release --locked
```

公共入口为 `detect_bytes`，返回字段包括 `cols`、`rows`、`step_x`、`step_y`、`consensus` 和 `confidence`。Python 绑定由独立集成模块提供，本 crate 不依赖 Python 或 Windup 后端。

## Capability boundary

传统网格检测默认面向隐含像素单元不小于约 3px 的输入。小于 3px 的高密度伪像素可能缺少足够的周期证据，本模块暂不保证其自动识别结果；调用方应允许用户提供显式像素尺寸。这里不添加针对单张图片的启发式特例。
