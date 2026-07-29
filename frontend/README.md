# Windup 前端

React + Vite + TypeScript + Tailwind CSS。完整架构以仓库根目录的
[frontend-architecture-v3.md](../frontend-architecture-v3.md) 为准，接口联调状态见
[API_CONTRACT.md](API_CONTRACT.md)。

## 运行

~~~bash
cd frontend
npm install
npm run dev
npm run typecheck
npm run test
npm run lint
npm run format:check
npm run build
~~~

开发环境默认使用 app 层注入的 Project 内存 Repository，便于在后端未启动时开发页面。需要参考
已关闭且未合并的 PR #57 临时联调候选映射时，在 `.env.local` 中显式设置：

~~~dotenv
VITE_PROJECT_ADAPTER=pr57-candidate
VITE_API_BASE_URL=/api
~~~

正式 Project OpenAPI 尚未接入，生产组合会明确返回不可用，不会装配候选接口或回退开发数据。

## CI Preview

Vercel 项目的 Root Directory 设置为 `frontend`，其余构建与 SPA 路由配置由
[`vercel.json`](vercel.json) 管理。Vercel 的 Preview 环境必须设置：

~~~dotenv
VITE_APP_ENV=preview
~~~

该变量只用于 PR Preview，显式启用演示数据；Production 环境不得设置，仍遵守正式接口未接入时
明确不可用的边界。仓库不保存 Vercel Token 或其他部署密钥。

## 路由

- `/`：选择 Quick Start 或从项目开始。
- `/quick-start`：自然语言输入；自动创建 Project 与 WorkflowRun。
- `/quick-start/:runId`：Quick Start 简化创作台，隐藏节点与版本术语。
- `/projects`：项目列表。
- `/projects/:projectId`：项目详情。
- `/projects/:projectId/assets`：项目资产库。
- `/workflow-editor/:runId`：当前 Revision 的工作流入口。
- `/workflow-editor/:runId/:stage`：当前 Revision 的指定节点。
- `/playtest/:characterId?runId=:runId&revision=:revisionId`：独立核验台。

## 分层

~~~text
app -> pages -> features -> capabilities -> entities -> shared
~~~

- `app`：启动、Router、全局布局、错误边界和应用服务组合。
- `pages`：路由、URL、页面临时状态和模块组合。
- `features`：生成、角色设置、审核、导出和 Quick Start 等用户操作。
- `capabilities`：调用外部能力的稳定 Port、服务和 Adapter；当前包含图片生成与图片上传。
- `entities`：Project、Character、Task、WorkflowRun 等有身份或生命周期的数据。
- `shared`：真实 HTTP transport、通用分页、React hooks 和无业务 UI。

跨 Slice 只能走目录根 `index.ts(x)`。上层使用 Entity 时统一从 `@/entities` 进入。Page、Feature
和 Entity 不直接调用 `fetch`；HTTP Adapter 经 `shared/api` 发请求。

## 一套制作流程，两种控制方式

Quick Start 与手动 Workflow 共用同一种 WorkflowRun、Revision 和五个有序节点：`asset`、
`generation`、`candidate`、`review`、`export`。手动模式等待用户逐步操作；Quick Start 将来由前端
Agent 自动提交相同命令连续推进。隐藏步骤不等于跳过步骤。

Quick Start 先通过注入的 Project Repository 创建 Project，再用返回的 Project ID 创建
WorkflowRun，禁止使用 `quick-start` 一类伪 ID。两种入口都从 `asset` 和 `not_started` 开始，
真正进入生成节点后才切换为 `in_progress`。

WorkflowRun 是前端编排模型，通过返回 Promise 的本地 Repository 持久化，不对应后端
`/workflows` 资源。内存覆盖层会保护 localStorage 写入失败后的最新数据；恢复时完整校验 run、
revision、node 和状态；ID 在 `randomUUID` 缺失时也有后备生成方式。

## 外部能力边界

- Project 页面和 Quick Start 只依赖同一份异步 `ProjectRepository`。开发默认使用内存实现，也可
  显式选择 PR #57 候选映射；生产在正式 OpenAPI 到位前保持不可用。
- 图片生成位于 `capabilities/image-generation`。当前 Port 已冻结，真实 HTTP 路径尚未冻结，因此
  不提供猜测的 Real Adapter。
- 图片上传位于 `capabilities/image-upload`。HTTP Adapter 负责格式、10 MiB 上限、multipart 和响应
  URL 映射，不属于 Project Entity。
- `Task` 是独立 Entity；`WorkflowTaskLink` 只负责把后端任务映射到前端 WorkflowRun 节点。
- Generation、Review、Export 等未接通能力会明确保持未实现，不返回伪造成功。
