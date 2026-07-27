# Windup 前端骨架

React + Vite + TypeScript + Tailwind。依赖分层见本文，模块契约见
[`MODULES.md`](./MODULES.md)。

## 跑起来

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run test       # 单元测试
npm run typecheck
npm run build
npm run lint
```

后端接口没到位之前默认走 mock，不用起后端也能开发。连真后端：`frontend/.env.local`
里写 `VITE_USE_MOCK=false`，dev server 会把 `/api` 代理到 `http://127.0.0.1:8000`。

## 分层与依赖

`app → pages → features → entities → shared`，只能往下依赖；同层 Slice 不互相 import；
跨 Slice 一律走各自的 `index.ts`，不碰别人的内部文件。

| 层 | 内容 |
|---|---|
| `app` | Router、全局外壳 `AppShell` |
| `pages` | quick-start / workflow-editor / projects / asset-library / playtest |
| `features` | character-setup / generation / review / export |
| `entities` | project / character / action-template / wearable / workflow-run |
| `shared` | api（client 下 real、mock、mappers）、ui、lib、testing |

分层是代码分类和依赖规则，不等于模块清单。当前只把数据层、Workflow Editor、
检查/预览台以及两个 Header 公开组件列为模块边界；具体职责、入口和不负责的内容
统一记在 `MODULES.md`。

## 当前实现程度

空的是实现不是接口：函数体多为 `throw new Error('not implemented')`，但公开函数、
Props、参数与返回类型已列出。Project 已对接 PR #57；Character、WorkflowRun、
ActionTemplate、Wearable 和 SSE 仍是待前后端共同 Review 的提案，不是已冻结契约。

Quick Start 创建 AI 驱动的 `WorkflowRun` 后留在本页展示进度与结果；
Workflow Editor 从自己的入口创建或恢复手动 `WorkflowRun`。两个页面只共享
`entities/workflow-run` 这一个工作流边界，不互相跳转或引用。当前 Quick Start 已完成
AI `WorkflowRun` 的创建和本页承载；本地骨架已通过 `suggestNextCommand →
submitWorkflowStep` 自动推进。真实 AI 计划解析、生成任务和进度事件仍待后端接入。
后端暂不存 workflow，当前 runId 由本地存储生成。项目数据仍走 api + mock。

`entities/workflow-run/model/selectors.ts` 里「当前步骤、此刻允许哪些操作、AI 下一步
做什么」是真实现，已有单元测试覆盖。

## 与后端的对接状态

**已确认（2026-07-27，据后端 PR #57）：**

- 后端**暂不存 workflow**，只提供图片与资源接口，以后会存。因此工作流状态先落
  localStorage（`entities/workflow-run/api/local-store.ts`）。公开签名以“后端接管时尽量只替换
  `api/` 实现”为设计目标，但未经前后端 Review 前不作不变保证。
- 「当前可执行哪些操作」后端不返回，由前端推导，`model/selectors.ts` 保留。
- 生成为异步任务的方向保留；`TaskEvent` 的具体字段仍待后端确认。
- PR #57 当前的 Project 业务响应使用 HTTP 200，成功失败看响应体 `code`；
  `timestamp` 可选。这不扩大为全后端的永久规则。
- 无更新项目接口，前端不要调 `PUT/PATCH /projects/{id}`。

**仍待确认：**

1. `character_perspective` 与 `directional_movement` 的 1–3 分别代表什么。
2. 精灵尺寸是接受 32–2048 任意整数，还是只接受七个档位。
3. `user_id` 何时改为由后端从 token 推出。
4. `WorkflowRun.id` 前端当前为 string，但 `windup_project.workflow_id` 是 BIGINT。
5. 生成异步链路的 task id、SSE 端点、事件字段和结果形状。
6. 角色、动作、帧、资产库的路径、字段和 ID 类型。
7. 一个动作的帧数由哪个后端字段提供，前端不写死。

完整问题已单独整理为 `前后端待确认字段清单_2026-07-27.md`，未经确认前不视为正式契约。
