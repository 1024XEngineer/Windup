# Production Engine

Production Engine 是 Quick Start 和手动 Workflow 共用的前端制作编排层。它不知道调用者是 AI
还是用户，也不根据 `driver` 分支：手动控制器每次只调用一步，Quick Start Agent 将来连续调用同一套
方法。两个页面的布局、文案和交互保持完全独立。

当前由 app 组合层装配：Preview 使用同契约异步 Mock 跑通已配置的生成循环，Production 在真实 Adapter
未配置时明确失败。实现必须遵守以下规则：

- 每次调用绑定 `runId + revisionId + nodeId + attemptId`，结果只能写回当时仍有效的精确目标。
- 同一节点开始新 attempt 或用户中断 Quick Start 时，旧 attempt 必须先在前端失效；
  旧 Promise、Task 事件或生成结果即使迟到，也不得写回流程或覆盖新结果。
- PR #64 只有 Generation ABC/模型，没有真实路由；底层生成 Port 只提交并返回 Task，
  Task Repository/Event Source 也只有契约，不提前实现轮询、SSE 或等待策略。
- Production Engine 未来内部编排 Task 生命周期，对上仍返回按生成类型区分的最终结果；页面不直接使用 Task。
- Task 按前端可视步骤固定为 `character_template`、`first_frame`、`complete_animation`；动作输入必须包含 Outfit 归属。
- 当前没有真实 Generation OpenAPI Adapter，因此 app 不伪造生产成功结果。

Playtest 不属于 Production Engine 的推进步骤。它可以保存独立核验记录，但不写入制作流程、
Character 或生成产物。

`cancelAttempt` 只取消单次生成；它不停止 Quick Start Agent，也不创建新 Revision。Quick Start 会话中断
和 Workflow Restart 分别由各自 Application Port 负责。未来取消实现按以下顺序工作：

1. 先使精确 attempt 在前端失效，以“不再写回”作为可靠保证。
2. 如果生成提交还在途，通过传给 ImageGeneration Adapter 的 `AbortSignal` 尽快中止前端请求。
3. 如果已取得 `taskId`，再调用 `TaskRepository.cancel(taskId)` 尽力请求后端取消。

PR #64 的取消能力只保证取消尚未运行的 `pending` 任务，不能承诺终止已经 `running`
的模型计算。因此远端取消失败或迟到结果都不得让 attempt 重新有效。上层继续稳定使用
`ProductionEnginePort.cancelAttempt(target)`；未来后端增强为可终止运行中任务时，不需要改页面或 Quick Start Port。
