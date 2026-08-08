# History 页面模块

History 只读展示项目下已经保存的 `WorkflowRun` 及其当前节点图。

## 当前模型

- `WorkflowRun` 直接保存 `nodes`，节点之间的边由 `dependsOnNodeIds` 表达。
- 页面不再使用已经删除的 Revision、Step、driver、purpose 或本地 Store。
- 进行中、失败、完成由节点状态派生，不向 `WorkflowRun` 增加重复状态字段。
- Quick Start 与 Workflow Editor 共用同一份 Run；当前模型不保存入口来源，因此历史页统一进入 Workflow Editor。

## 后端缺口

后端当前只有单条 WorkflowRun 的创建、读取、更新和删除接口，没有按 Project 列表查询。
因此本页面只声明异步 `WorkflowHistoryReader.listByProject(projectId)` 边界，不提供假数据、
localStorage 降级或伪造 HTTP 路径。正式列表接口落地后由 App 装配真实实现。

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
