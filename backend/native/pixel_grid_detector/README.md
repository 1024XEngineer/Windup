# Pixel grid detector

Windup 的独立本地像素网格识别器。它只读取 PNG/JPEG 字节并输出网格元数据，不负责重建图片，也不引用任何生成管线或应用服务。

默认执行 Pixel Art Fixer 的完整多检测器共识流程：autocorrelation、run-length comb、shift self-similarity 与证据仲裁。`--fast` 仅用于显式选择低延迟模式。

```bash
cargo run --release -- < input.png
cargo run --release -- --fast < input.png
```

输出字段包括 `cols`、`rows`、`step_x`、`step_y`、`consensus` 和 `confidence`。

## Capability boundary

传统网格检测默认面向隐含像素单元不小于约 3px 的输入。小于 3px 的高密度伪像素可能缺少足够的周期证据，本模块暂不保证其自动识别结果；调用方应允许用户提供显式像素尺寸。这里不添加针对单张图片的启发式特例。
