# chaifen/06-history 向主线 WorkflowRun/Controller 看齐

## 背景

chaifen/06-history 工作目录包含大量过时的 Revision/Step 模型残留，与主线的扁平 nodes 模型不一致。需要清理死代码并更新 History 页面。

## 前置确认

经文件对比，`chaifen/06-history` 的 `entities/workflow-run/index.ts`（顶层）已经正确导入 `./workflow-run/`（嵌套目录）并重新导出扁平 nodes 模型。`entities/index.ts` 的导出列表也已匹配主线。因此 barrel 链路是通的，问题在于残留的旧目录。

## 执行计划

### Step 1: 删除过时的 model/ 目录

删除 `frontend/src/entities/workflow-run/model/` 整个目录。

该目录包含 Revision/Step 模型（`types.ts` 有 `WorkflowRevision`、`WorkflowStep`、`WorkflowRunSnapshot` 等）、旧常量（`WORKFLOW_STEP_TYPES`、`WORKFLOW_STEP_PHASES` 等）和 selectors。这些在主线中已不存在，且没有被顶层 barrel 导出。

### Step 2: 删除过时的 service/ 目录

删除 `frontend/src/entities/workflow-run/service/` 整个目录。

该目录包含 945 行的 `WorkflowRunService` 实现，依赖 Revision 模型。主线已将编排逻辑移到 `features/workflow-controller`。

### Step 3: 删除过时的 store/ 目录

删除 `frontend/src/entities/workflow-run/store/` 整个目录。

该目录包含 localStorage-based `WorkflowRunRepository`（版本 8）。主线的 Store 已移到 `workflow-run/workflow-run/store.ts`（HTTP + 内存）。

### Step 4: 删除顶层 workflow-run/README.md

该 README 描述的是旧的 Repository/stepId 契约，与当前实现不符。

### Step 5: 用主线版本覆盖 History 页面

将主线 `.pr70-playtest-worktree/frontend/src/pages/history/index.tsx` 的当前内容（含本次 8 项修复）复制到 `chaifen/06-history/frontend/src/pages/history/index.tsx`。

### Step 6: 重写 History 测试

当前 `index.test.tsx` 导入 `HistoryController`，使用 `revisions`/`driver`/`steps` — 全部过时。重写为匹配 `WorkflowRunStore` 接口的测试，覆盖：
- 三区分列（active / interrupted / completed+failed）
- 空状态
- loading 态
- error 态
- 按 createdAt 降序

### Step 7: 更新 History README

更新 `pages/history/README.md`，对齐当前 `WorkflowRunStore` 接口和三区分列设计。删除对 Repository/stepId/Revision 的描述。

### Step 8: 删除嵌套的 workflow-controller 重复目录

删除 `frontend/src/features/workflow-controller/workflow-controller/` 整个嵌套目录。这是 `features/workflow-controller/` 的完整副本。

### Step 9: 验证

在 chaifen/06-history 工作目录中确认：
- 无 TypeScript 编译错误（针对 pages/history 和 entities/workflow-run）
- 无残留的 `import from './model/'` 或 `import from './service/'`
- barrel 导出链路完整

## 涉及文件

| 操作 | 路径 |
|---|---|
| 删除 | `frontend/src/entities/workflow-run/model/` |
| 删除 | `frontend/src/entities/workflow-run/service/` |
| 删除 | `frontend/src/entities/workflow-run/store/` |
| 删除 | `frontend/src/entities/workflow-run/README.md` |
| 删除 | `frontend/src/features/workflow-controller/workflow-controller/` |
| 覆盖 | `frontend/src/pages/history/index.tsx` |
| 重写 | `frontend/src/pages/history/index.test.tsx` |
| 更新 | `frontend/src/pages/history/README.md` |
