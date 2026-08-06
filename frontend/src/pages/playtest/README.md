# Playtest

核验台只负责一件事：用角色造型中已经确认的动作帧，真实操控当前角色。

## 入口

`/playtest/:characterId/:outfitId`，可选 `?actionId=` 指定打开时绑定的动作。页面通过
`@/entities` 的 `characterApis.get` 读取 `Character`，后端地址沿用 `VITE_API_BASE_URL`。

读取失败或造型不存在时显示错误，不回退到任何内置数据。仓库里也不存放演示素材，正式路径的
每一帧都来自后端。

## 页面边界

Playtest 位于 `pages/playtest`，只依赖 `@/entities` 的 Character 公开类型与读取接口，以及
`@/shared/api` 的错误类型。页面不导入 features、不碰 Workflow 与 Generation，也不修改
Character、Outfit、Action、Frame 或后端数据。这几条由 `playtest-boundaries.test.ts` 看着。

`createPlaytestModel` 是页面内的窄适配器，只留下动作 ID、名称、类型、帧图片和播放时长。
播放顺序按 `Frame.index` 排定，不用数组下标——后端整棵下发资产树，数组顺序没有契约保证。
帧自己的 `durationMs` 优先，缺失时才按所属 Action 的 `fps` 换算。审核、导出、时间线和生成
字段不进入运行时。

## 操控

- 页面绑定当前造型下全部有帧的动作，点击动作名可以直接切换。
- 按住 A / D 或 ← / → 时，角色按 150 px/s 连续移动并切到首个 walk 动作。
- 松开所有横向按键后切回首个 idle 动作。
- 动作帧按各自时长循环，角色位移使用 `requestAnimationFrame` 的真实时间差计算，两者互不
  耦合。
- 舞台按实际宽度限制移动范围；窗口尺寸变化时重新计算。

视觉复用 livedemo 的白色透明棋盘画布、悬浮控制胶囊和动作状态层级，代码使用项目现有的
React、TypeScript 与 Tailwind。顶栏悬浮不占布局高度，页面自己让出 `pt-24` 的避让空间。
