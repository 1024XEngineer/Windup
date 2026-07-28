# Windup 前端

React + Vite + TypeScript + Tailwind CSS。当前架构定义以仓库根目录的
frontend-architecture-v3.md 为准。

## 运行

~~~bash
cd frontend
npm install
npm run dev
npm run typecheck
npm run build
npm run test
npm run lint
npm run format
npm run format:check
~~~

接口联调状态、请求形式与未接通能力见 [API_CONTRACT.md](API_CONTRACT.md)。

默认页面是 Home：

- /：选择 Quick Start 或从项目开始
- /quick-start：自然语言输入；创建 WorkflowRun 后进入独立的简化创作台，隐藏工作流节点与版本术语
- /quick-start/:runId：Quick Start 的持续创作页；以自然语言展示生成、检查和结果状态
- /projects：项目列表
- /projects/:projectId：项目详情
- /projects/:projectId/assets：项目资产库；展示项目资产及系统内置动作模板
- /workflow-editor/:runId：当前 Revision 的工作流入口
- /workflow-editor/:runId/:stage：当前 Revision 的工作流节点
- /playtest/:characterId?runId=:runId&revision=:revisionId：独立核验台

## 分层

~~~text
app -> pages -> features -> entities -> shared
~~~

- app：启动、Router、全局布局和错误边界。
- pages：路由、URL、页面临时状态和模块组合。
- features：生成、角色设置、审核和导出等用户操作。
- entities：Project、Character、WorkflowRun、Revision 和领域规则。
- shared：通用 API transport、React hooks、UI 和测试辅助。

跨模块只能走公开 index.ts；页面、Feature 和 Entity 不直接调用 fetch。

## WorkflowRun

Quick Start 与手动 Workflow 共用同一个 WorkflowRun。一个 run 可以有多个 Revision；
从某节点重新开始会保留节点及以前的参考，移除之后的当前执行线，旧 Revision 仍只读保留。

Quick Start 不展示节点、Revision 或 Workflow Editor。它以简化创作台呈现自然语言进度；
完成后满足条件时可导入核验台，导出入口待后端任务接入。Workflow Editor 则保留完整的人工控制能力。

WorkflowRun 是前端编排模型，通过 Entity 内返回 Promise 的 Repository Port 访问。三个编排函数
只依赖唯一组合入口；当前入口选择 localStorage Adapter，不经过 shared/api，也不对应后端
`/workflows` 资源。未来增加真实 Adapter 时只更换该入口，页面调用方式不变。

本地存储以当前会话内存覆盖磁盘旧快照，写入失败不会让刚创建的流程消失；读取磁盘记录时会完整
校验 run、revision、node 和状态。ID 在 `randomUUID` 缺失的环境也能生成。手动流程先处于
`not_started`，进入 generation 节点后才切换为 `in_progress`。数据模型使用 Revision + 有序五节点：
asset、generation、candidate、review、export。

Project、Media、Generation、Asset、Review、Playtest、Export 等独立后端能力仍经 shared/api 的
Mock/Real transport 切换。OpenAPI 落地后只替换这些能力 Adapter，页面继续使用现有 WorkflowRun
门面。

Provider、系统质量门禁、SSE、正式角色资产和导出任务尚待后端契约；未实现能力不会返回伪造成功。
本地 WorkflowRun 的节点变化只表达页面编排状态，不代表后端已经生成、审核或导出产物。
