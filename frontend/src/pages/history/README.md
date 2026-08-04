# History 页面模块

History 展示项目下的 WorkflowRun 和其内部 Revision。它回答“这次任务做到了哪一步、重做过几次、当前该继续还是只读查看”，不展示正式角色资产，也不记录 Playtest 核验结论。

## 数据层级

```text
Project
└── WorkflowRun（一次创建角色或生成动作任务）
    └── WorkflowRevision（同一任务的一次执行版本）
        └── WorkflowStep（该版本中的有序步骤）
```

页面不能把 Revision 拍平成新的 Run。用户主动重做时 Run ID 不变，旧 Revision 仍用于解释新结果从哪里产生。

## 数据怎么进入页面

1. 路由提供 `projectId`。
2. 页面调用 `controller.listWorkflows(projectId)` 读取初始快照。
3. 页面通过 `controller.subscribeAll()` 接收全局变化，并再次按 `projectId` 过滤。
4. 页面卸载时调用 Controller 返回的取消订阅函数。

页面不接触 `WorkflowRunStore`、localStorage 或后端传输。History 在页面入口声明只包含 `listWorkflows` 与 `subscribeAll` 的只读接口；正式 WorkflowController 只要满足这两个方法就能注入。将来持久化方式改变时，History 无需跟着改写。

## 页面状态

- **进行中**：可以继续；AI 驱动的 Run 返回 Quick Start，手动 Run 返回 Workflow Editor。
- **已中断**：任务未失败，仍按原来的交互界面恢复。
- **失败**：保留错误任务，供用户查看问题。
- **已完成**：只读查看任务和全部 Revision。
- **无效记录**：`currentRevisionId` 找不到对应 Revision 时明确报错，不让整个历史页崩溃。

每张 Run 卡片展示任务目的、最近 Revision 时间、当前版本、步骤进度和版本数量。展开后显示每个 Revision 的来源、重开步骤和步骤状态。当前 WorkflowRun 没有独立的 `updatedAt` 字段，因此页面以最新 Revision 的 `createdAt` 作为最近活动时间，不伪造 Entity 数据。

History 只选择恢复目标并传递 `runId`。真正的状态恢复由 Quick Start 或 Workflow Editor 调用 `WorkflowController.resume(runId)` 完成，History 不复制恢复逻辑。

正式应用接入 `/projects/:projectId/history` 时，顶部产品导航仍由 AppShell 提供，但应放在普通文档流中。用户向下浏览较长的历史列表时，导航随页面一起滚走，不固定或吸附在视口顶部。

## 模块边界

History 可以依赖 `@/entities` 的公开类型，并由外层注入满足只读接口的 WorkflowController，但不得：

- 直接读取 Store 或 localStorage。
- 调用生成、候选确认、审核或发布命令。
- 从 Character 或 Playtest 数据反推 WorkflowRun 状态。
- 实现资产库、Workflow Editor 或 AppShell。

## 验证

```bash
npm test -- src/pages/history
npm run typecheck
npm run lint
npm run build
```

测试覆盖项目隔离、最近 Revision 时间排序、四种 Run 状态、Revision 来源、步骤明细、订阅更新、取消订阅、空状态、错误状态和坏记录。
