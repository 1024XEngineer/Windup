# Export Package 模块

本模块把 WorkflowRun 当前已完成的角色素材整理为可下载 ZIP。它不负责生成图片、保存历史记录或发布资产，只负责按完成度验证和导出。

## 渐进阶段

1. `character`：角色母版、项目画布、Character / Outfit 和来源 Run。
2. `first-frame`：保留基础包并追加每个已确认动作的首帧与配置。
3. `action-assets`：继续追加完整帧、逐帧时长、图集和质量状态；尚未审核时为 `pending`。
4. `playtest`：只使用已发布动作，并追加 `playtest.json` 运行清单。

四个阶段使用相同的 `characterName + characterId + outfitName + outfitId` 包根目录。后阶段只追加内容，不另造导出格式。

## 数据怎么走

1. Quick Start、Workflow Editor、CharacterDetail 或 App 层 Playtest 组合点，用同一个渐进装配器生成 `ExportPackageModel`。
2. `validateExportPackageModel` 检查角色、画布、生成记录、帧数、质量状态、锚点和脚底线。
3. `createAssetExportPlan` 为每个动作方向生成稳定目录与三位连续帧名。
4. `exportGameAssets` 读取透明 PNG，并检查图片尺寸是否与统一画布一致。
5. 浏览器生成无损 PNG Sprite Sheet 与兼容 GIF 预览，最后写入动画 `meta.json`、`schema.json`、README 与 ZIP。
6. 可选 target 只在 `targets/<target-id>/` 下追加引擎文件，不修改通用层。

## 导出结构

```text
Aster-character-1-Explorer-outfit-1/
  character/master.png
  first-frames/Walk-walk.png
  meta.json
  schema.json
  README.md
  frames/Walk/Walk_000.png
  atlas/Walk.png
  preview/Walk.gif
  playtest.json
  targets/cocos-creator-3x/
    atlases/Walk.png
    atlases/Walk.plist
    windup-animation.json
```

`meta.json` 的坐标原点在左上角，y 轴向下。`anchor` 是 0-1 归一化坐标，`foot_y` 是从画布顶部开始计算的像素值。

`preview/*.gif` 只用于快速查看和旧平台兼容，最多 256 色且只支持一位透明度。正式游戏资产应读取逐帧无损的 `frames/*.png`，或使用 `atlas/*.png` 与 `meta.json` 中的方向、逐帧时长、锚点和图集切分信息。

## 为什么缺一帧就全部失败

已发布 Character 动作的 `expectedFrameCount` 来自后端声明，不能用 `frames.length` 自己推算；两者不同时导出立即失败。WorkflowRun 中尚未发布的生成结果没有独立的期望总帧数字段，因此当前只能校验帧序从 0 连续，不能识别生成服务在末尾少返回帧。所有阶段遇到图片读取失败、PNG 无透明信息或尺寸不一致都会失败，不会用透明占位掩盖问题。`action-assets` 可保留 `pending` 质量状态供检查；`playtest` 只接受 `passed` 动作。

## Cocos Creator 3.x

默认下载包会在 `targets/cocos-creator-3x/` 中追加同名 PNG 与 TexturePacker plist。把 `atlases/` 内的 PNG 和 plist 一起放入 Creator 资源目录，Creator 会把它们导入为 SpriteAtlas 与 SpriteFrame 子资源。`windup-animation.json` 保留每帧时长、循环、方向、锚点和脚底线，供项目侧创建 AnimationClip 或运行时播放器。

本模块不生成 `.meta` 或 `.anim`：这些文件携带由实际 Creator 项目和版本管理的 UUID。Cocos 坐标转换规则是把通用锚点 `(x, y)` 转成 Creator 锚点 `(x, 1-y)`。

## 验证

```bash
npm test -- src/features/export-package
npm run typecheck
npm run lint
npm run build
```

测试覆盖 Schema 校验、连续命名、图集输出、Cocos PNG/plist、缺帧失败、质量门禁、图片释放和 target 扩展。

## 当前主线接线

- WorkflowRun 的完整动画结果可在发布前以 `pending` 动作资产导出；Character 资产树中的已发布动作标记为 `passed`。
- 帧顺序使用后端显式 `Frame.index`，断号或重复序号会在读取图片前失败。
- 预览与导出共用同一份逐帧时长解析规则；密集生成动作会按规范化周期播放。
- 锚点和脚线沿用 `ai_engine.align_bottom_center` 的底部居中与 `0.92` 脚线约定。
- 四向和八向导出真实源方向；由东向帧镜像得到的西向在运行时按方向配置处理，避免重复生成源资产。
