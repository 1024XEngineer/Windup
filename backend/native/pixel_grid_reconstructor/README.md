# Pixel grid reconstructor

Windup 的独立显式网格重建器。它不检测像素密度，只读取 PNG/JPEG 字节与明确的 `cols`、`rows`、`colors` 参数，并输出对应尺寸的原生 1x PNG。

```bash
cargo run --release -- --cols 64 --rows 64 --colors 32 < input.png > output.png
```

模块使用两阶段重建：先对结构色标签投票确定每个格子的归属，再从原图中携带胜出标签的像素恢复颜色。输出的每个像素就是一个规则网格单元，透明度按格内多数票确定。

`colors` 控制结构聚类规模，不是最终图片的强制全局色板上限；这样不会把稀有高光或单像素强调色提前删除。若业务需要固定总色板，应在独立的调色板阶段明确处理。
