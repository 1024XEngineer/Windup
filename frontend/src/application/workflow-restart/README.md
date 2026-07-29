# Workflow Restart

保留“从节点重新开始”的前端用例边界。Preview 在 app 组合层提供同契约实现；Production 等待后端
WorkflowRun/Revision 接口后装配真实 Adapter。

未来实现如果发现当前生成仍在运行，必须先通过 Production Engine 使精确的
`runId + revisionId + nodeId + attemptId` 在前端失效，再请求 WorkflowRun 创建新 Revision。后端取消
只是尽力请求，迟到结果不得写入新执行线；当前骨架不会伪造已中断或已重启的成功结果。

`interrupted` 是 WorkflowRun 的用户主动停止状态，旧 Revision 仍保留为可只读历史。未来从其历史节点
成功创建新 Revision 后，WorkflowRun 可重新进入 `active`；这不会把旧历史改写成 `failed` 或
`completed`，也不代表对应后端 Task 已真正终止。

Repository 只负责保存用例计算后的快照，不公开 `restart-from-node` 命令；页面不能绕过本用例直接重启。
