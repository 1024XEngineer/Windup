# Playtest 模块

Playtest 是已经生成完成的角色动画工作台。它不负责生成过程、历史记录或资产库目录管理；它只读取正式 `Character` 数据，让用户在同一页面切换角色造型和动作、播放逐帧动画、检查质量并保存当前核验结论。

## 页面入口

- `/playtest`：入口页。扫描现有项目，找到第一个含有效动画帧的角色后自动进入工作台；没有可播放内容时显示明确空状态。
- `/playtest/:characterId/:outfitId?actionId=:actionId`：正式工作台。路径确定角色和造型，查询参数只确定当前动作。

Playtest 路由不套用站点目录栏，避免全局导航挤占工作区。新增动作由左栏 `+` 进入 Quick Start，生成和发布仍由 Quick Start/Workflow 模块负责。

## 用户流程

1. 根入口汇总所有项目中的角色，并过滤空造型、零帧动作和最终无可播放内容的角色。
2. 左栏显示所有可播放造型。缩略图、动作名、真实造型名和角色 ID 共同区分后端默认命名的内容。
3. 选择造型后切换完整工作台上下文；选择动作只切换当前播放控制器，不新开页面。
4. 用户可以修改当前造型名、修改动作名、删除动作或删除造型。仅这些明确操作会调用 `CharacterApis.update/remove`。
5. 舞台、时间线、帧检查和问题记录共享同一个播放状态，避免不同面板显示不同动作或帧。
6. 当前帧图片必须在浏览器中成功加载，才允许保存“核验通过”；图片失败时仍允许保存“发现问题”。

## 文件职责

- `assets.ts`：生成 Playtest 专用只读视图，并跨项目汇总可播放角色。
- `entry.tsx`：解析根入口应跳转到哪个工作台地址。
- `index.tsx`：加载页面数据、处理路由切换以及造型/动作改名和删除。
- `path.ts`：统一生成 Playtest 地址。
- `workbench/action-selector.tsx`：左栏造型和动作切换、管理操作界面。
- `workbench/index.tsx`：组装舞台、播放控制、时间线、检查工具和核验状态。
- `workbench/analysis/`：只读质量证据计算，不修改正式资产。

## 数据边界

普通播放和自动分析不会修改 `Character`。改名和删除必须由用户明确触发，并通过后端接口保存；操作失败时页面保留原状态并显示错误。PlaytestInspection 只表示某个动作当前的核验结论，不形成历史版本。

本模块不包含 WorkflowRun、WorkflowController、Quick Start 生成实现、历史记录、资产库、导出打包、后端代码、数据库、日志或构建产物。

## 验证

```bash
npm run test -- --run src/pages/playtest
npm run typecheck
npm run lint
npm run build
```

重点回归根入口自动跳转、跨项目切换、默认命名区分、改名/删除写入、不同动作切换，以及图片加载失败时不能标记通过。
