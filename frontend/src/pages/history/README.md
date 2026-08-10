# History 页面模块

History 只读展示项目下已经保存的 `WorkflowRun` 及其当前节点图。当前阶段只保留模块骨架，
不注册 App 路由，也不在项目导航中提供入口。

## 当前模型

- `WorkflowRun` 直接保存 `nodes`，节点之间的边由 `dependsOnNodeIds` 表达。
- 页面不再使用已经删除的 Revision、Step、driver、purpose 或本地 Store。
- 进行中、失败、完成由节点状态派生，不向 `WorkflowRun` 增加重复状态字段。
- Quick Start 与 Workflow Editor 共用同一份 Run；当前模型不保存入口来源，因此历史页统一进入 Workflow Editor。
- 页面不提供“新建创作任务”入口；创建工作流必须先由正式用例取得真实 `runId`，再进入
  `/workflow-editor/:runId`。

## 接入状态

后端 PR #176 已提供按 Project 分页查询 WorkflowRun 的接口。本页面继续只声明异步
`WorkflowHistoryReader.listByProject(projectId)` 边界，不提供假数据或 localStorage 降级。
待 WorkflowRunStore 的真实适配器合并并由 App 装配后，再注册路由和导航入口。

## 模块边界

History 可以读取 `@/entities` 的公开 WorkflowRun 类型，但不得推进节点、生成资产、修改审核结果，
也不得依赖单条 Run 的 WorkflowController。

## 验证

```bash
npm test -- src/pages/history
npm run typecheck
npm run lint
npm run build
```
