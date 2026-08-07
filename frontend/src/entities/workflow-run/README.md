# WorkflowRun

本目录保存前端工作流程的核心数据模型和持久化契约，不引入 Snapshot、Handle 或另一套运行对象。

## 概念关系

- `WorkflowRun`：一条完整的前端制作流程，包含所属项目、角色关联、当前状态和全部步骤。
  后端采用树状纯存储模型，不提供回退或版本历史能力。用户重做某个步骤时，前端直接覆盖
  当前结果，不保留被废弃的历史链路。
- `WorkflowStep`：Run 内的具体步骤。前三个步骤（character-setup → character-template →
  template-candidate）串行推进，之后可以随时追加 `action-generation + review` 成对步骤。
  多个 action-generation 可并发执行——第一个 action 还在生成中就可以开始第二个，
  互不阻塞。
- `WorkflowRunStore`：异步持久化契约，定义 `create` / `get` / `getByCharacter` / `list` / `save`
  五个方法。持久化走服务端 API，前端不保留 localStorage 副本，也不提供 subscribe 监听。

`WorkflowRun` 的节点判断和推进规则留在前端；后端只按前端提交的完整快照做存取，不决定下一个
节点，同时继续负责 GenerationTask 和最终资产持久化。当前后端路由尚未落地，App 使用同契约的
内存实现等待接入；因此当前会话内可以完整运行，但浏览器硬刷新后的跨会话恢复要等后端 Store。
一个 Character 复用同一条 Run；新增动作不会创建第二条 Run。

## 文件

- `constants.ts`：状态和基础步骤顺序。
- `index.ts`：公开类型及模块出口。
- `store.ts`：异步持久化契约与 HTTP 适配实现。
- `store.test.ts`：持久化契约的单元测试。
