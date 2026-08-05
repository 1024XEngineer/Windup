# 前端模块拆分规划（chaifen 系列）

> 决策日期：2026-08-04
> 核心源目录：`.pr70-playtest-worktree`（分支 `feat/playtest-on-module-skeleton`）
> 拆分目标目录：`chaifen/`
> 范围决策：**只拆前端**；后端不拆分（见「后端（决策：不拆分）」）。

## 1. 拆分模式（01-04 已验证）

1. 每个模块 = `chaifen/0X-<name>` worktree + 独立分支 + 独立 PR（推送到 `1024XEngineer/Windup`）。
2. 每个 PR **只含模块自身文件**，通过「允许提交路径」白名单控制范围；配套源码在本地保留、不提交。
3. 新模块基于上一个已验证提交创建，形成顺序依赖链。
4. 每模块一份 `_PR说明.md` 管理文档（本地 exclude，不提交），记录范围、验证、改动记录。

## 2. 模块总表

### 已完成（01-06）

| # | 模块 | 分支 | 内容 | 状态 |
|---|---|---|---|---|
| 01 | workflow-run-core | `feat/workflow-run-core-clean` | `entities/workflow-run`（model/store/service） | PR #86 open |
| 02 | workflow-controller | `feat/workflow-controller-coordinator` | `features/workflow-controller`（controller.ts + tests） | 已推送 `5ec5ba3`，未开 PR |
| 03 | playtest | `split/playtest` | 数据适配器（`shared/api`、`entities/character\|project\|playtest-inspection`）+ 预览/质量内核 + 页面与路由（`pages/playtest`，含 `app.tsx`/`layout` 集成） | 三个提交齐备（`8f9abeb`），未推送 |
| 04 | quick-start | `split/quick-start` | `pages/quick-start`（index/service + tests） | PR #95 draft |
| 05 | export-package | `feat/export-package` | `features/export-package` 全量 + 契约（`contract.ts`、`cocos-target.ts`、schema、gifenc.d.ts）+ package.json/lock | PR #97 draft，已推送 `3cbfbc9` |
| 06 | history | `feat/history-page` | `pages/history`（index + tests） | PR #105 draft，已推送 |

### 进行中（07-09）

| # | 模块 | 分支 | 内容 | 状态 |
|---|---|---|---|---|
| 07 | media-upload | `feat/media-upload` | `entities/media` 适配器 + `shared/api/upload.ts` | Refs #109；文件就绪、未提交 |
| 08 | generation-sse-adapter | `feat/generation-sse-adapter` | `entities/generation` 适配器 + `shared/api/stream.ts` | Refs #78；验证通过（lint/typecheck/test/build）、未提交 |
| 09 | asset-library | — | `pages/asset-library/index.tsx` | 目录已建，worktree 待初始化 |

### 待拆（剩余）

| # | 模块 | 包含文件（白名单） | 说明 |
|---|---|---|---|
| — | publish-review | `features/publish/index.ts`、`workflow-to-character.ts`、`features/review/index.ts` | 原计划 06，顺延 |
| — | workflow-editor | `pages/workflow-editor/index.tsx`、`node-canvas.ts`、`service.ts`、`workflow-canvas.tsx`、`workflow-editor.css` | 原计划 07 |
| — | projects | `pages/projects/index.tsx`、`create-page.tsx`、`detail-page.tsx` | 原计划 10 |
| — | app-shell | `app/` 剩余（layout/`__fixtures__`/api-contract.test）、`pages/not-found/index.tsx`、`main.tsx`、`index.css` | 最后收口 |
| — | 规划外残留 | `pages/home/*`、`features/character-setup/*`、`features/export/index.ts`、`features/generation/index.ts`、`entities/project/index.ts`、playtest 剩余 4 文件、`shared/pagination` | 见备注 |

### 后端（决策：不拆分）

2026-08-04 决策：**不拆分后端**。`docs/module-split.md` 仅作为后端模块架构说明
（接口 / 模型 / 实现的组织方式），不作为拆分执行计划。后端改动直接在主分支常规流程推进。

## 3. 执行顺序与依赖

```
01 → 02 → 03 → 04 → 05 → 06(history) → 07(media) → 08(generation) → 09(asset-library)
→ publish-review → workflow-editor → projects → app-shell(收口)
```

- 01-06 已完成；07/08 文件就绪、待提交；09 待初始化。
- 07/08 基于 `main`（7ee5a98）自包含，不依赖功能分支。
- publish-review、workflow-editor 依赖 02-controller 与 01 entities，需在依赖合入后重放。
- app-shell 最后拆，负责把全部模块收口进 `app/` 路由。

> **编号说明：** 实际序列与原规划不同——06 拆的是 history（原 08），07/08 为新增的
> media-upload 与 generation-sse-adapter，原 06=publish-review、07=workflow-editor
> 顺延待拆。目录编号以 chaifen/ 实际为准，不再回填。

## 4. 每模块执行步骤

1. 在核心工作树确认模块文件完整（从核心源 `git add` 精确收集）。
2. `git worktree add chaifen/0X-<name> -b split/<name>`，基于上一个已验证提交（或 01 的 `feat/workflow-run-core-clean`）。
3. 新 worktree 基于基础提交展开（该提交已含模块骨架版本），从核心源逐文件复制模块的真实实现覆盖到对应路径（含 index.ts 入口与测试）。
4. 验证：格式（oxlint/prettier）、TypeScript、单元测试、生产构建通过。
5. 提交（conventional commits），更新 `_PR说明.md`（范围、验证结果、改动记录）。
6. 需要时推送到贡献者分支开 PR（是否推送由用户确认）。

## 5. 验证标准（每模块）

- [ ] 格式检查通过（允许路径文件）
- [ ] Lint 通过
- [ ] TypeScript 通过
- [ ] 单元测试通过
- [ ] 生产构建通过
- [ ] 范围检查：`upstream/main...HEAD` 差异只含白名单文件

## 6. 改动记录

### 2026-08-04 规划落盘

- 首次编写本规划：前端 05-11 拆分范围、后端 B 系列留待以后、执行顺序与验证标准。
- 决策：只拆前端、逐模块推进、规划写入 docs/。

### 2026-08-04 决策：后端不拆分

- 明确**不拆分后端**：`docs/module-split.md` 仅作架构说明，后端改动走常规流程。
- 更新范围决策与模块总表说明。

### 2026-08-04 状态同步（第二次检索）

- 05/06 已完成：05 增补 `3cbfbc9` 契约提交并推送；06 推送 `d2105bc`（PR #105）。
- 03 补齐第三个提交 `8f9abeb`（页面与路由集成，含 `app.tsx`/`layout` 改动），未推送。
  - ⚠️ 该提交越过了 playtest 边界进入 app-shell 文件；11 拆分时以主工作树完整版
    `app.tsx` 为准。
- 02 已推送 `5ec5ba3`（rebase 后哈希变化），未开 PR。
- 新增 07 media-upload（Refs #109）、08 generation-sse-adapter（Refs #78）：
  文件就绪、验证通过、未提交；09 asset-library 仅建目录，worktree 待初始化。
- 原规划编号作废：06=publish-review、07=workflow-editor、08=history；publish-review
  与 workflow-editor 顺延待拆（见「待拆（剩余）」）。
- 清理中间产物：主工作树根目录 5 张截图、06 本地预览文件
  （`history-preview.html`/`preview.tsx`）、02/06 的 node_modules 与 dist。
- 模块总表重写为实际状态；后续模块完成或推进时同步更新本表。
