# Export Package 模块

本模块把已经通过质量检测的角色动作整理为可下载 ZIP。它不负责生成图片、保存历史记录或发布资产，只负责验证和导出。

## 数据怎么走

1. 角色详情页用当前 Project、Character 和选中 Outfit 组装 `ExportPackageModel`。
2. `validateExportPackageModel` 检查角色、画布、生成记录、帧数、质量状态、锚点和脚底线。
3. `createAssetExportPlan` 为每个动作方向生成稳定目录与三位连续帧名。
4. `exportGameAssets` 读取透明 PNG，并检查图片尺寸是否与统一画布一致。
5. 浏览器生成 Sprite Sheet，最后写入动画 `meta.json`、`schema.json`、README 与 ZIP。
6. 可选 target 只在 `targets/<target-id>/` 下追加引擎文件，不修改通用层。

## 导出结构

```text
Aster-character-1/
  meta.json
  schema.json
  README.md
  frames/Walk-south/Walk-south_000.png
  atlas/Walk-south.png
  targets/<target-id>/...
```

`meta.json` 的坐标原点在左上角，y 轴向下。`anchor` 是 0-1 归一化坐标，`foot_y` 是从画布顶部开始计算的像素值。

## 为什么缺一帧就全部失败

`expectedFrameCount` 表示后端声明的完整帧数，不能用 `frames.length` 自己推算。两者不同、图片读取失败、PNG 无透明信息、尺寸不一致或 `qualityStatus` 不是 `passed` 时，导出立即失败，不会用透明占位掩盖问题，也不会下载残缺包。

## Cocos Creator 边界

Issue #94 要求先用真实 Cocos Creator 3.x 验证图集切分数据、`.anim`、`.meta`、UUID 与小版本差异。当前仓库没有该实测结论，因此本模块只落地已确定的通用层和 target 扩展接口，不伪造 Cocos 原生文件。

Cocos 坐标转换规则已经明确：通用锚点 `(x, y)` 转成 Creator 锚点 `(x, 1-y)`。等实测字段回填后，只需新增一个 `AssetExportTarget`，不改 `meta.json` 与通用打包逻辑。

## 验证

```bash
npm test -- src/features/export-package
npm run typecheck
npm run lint
npm run build
```

测试覆盖 Schema 校验、连续命名、图集输出、缺帧失败、质量门禁、图片释放和空 target 扩展。

## 当前主线接线

- Character 资产树只保存审核通过后发布的动作，因此适配器将其作为 `passed` 资产导出。
- 帧顺序使用后端显式 `Frame.index`，断号或重复序号会在读取图片前失败。
- `durationMs` 为空时才按 Action FPS 计算，不覆盖后端逐帧时长。
- 锚点和脚线沿用 `ai_engine.align_bottom_center` 的底部居中与 `0.92` 脚线约定。
- 当前 Character 只表达单方向动作，因此统一导出为 `default`；四向和八向需等待资产契约扩展。
