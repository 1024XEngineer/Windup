# Windup 前端模块契约

完整架构以根目录 [frontend-architecture-v3.md](../frontend-architecture-v3.md) 为准；本文记录当前代码
模块的公开边界。

## 分层与依赖

~~~text
app -> pages -> features -> capabilities -> entities -> shared
~~~

代码只能向下依赖。同层 Page、Feature 和 Capability Slice 不得互相导入；跨 Slice 只能从目录根
`index.ts(x)` 进入。Entity 作为一个数据模块，对上层只公开 `@/entities`。`shared` 不认识业务概念。

当前一级模块清单由架构测试锁定：

| 层 | 允许的一级模块 |
|---|---|
| pages | asset-library、home、not-found、playtest、project-detail、projects、quick-start、workflow-editor |
| features | character-setup、export、generation、quick-start、review |
| capabilities | image-generation、image-upload |
| entities | action-template、character、project、provider-session、task、wearable、workflow-run |
| shared | api、hooks、pagination、ui |

新增一级目录必须先明确它是页面、用户操作、外部能力、实体还是通用基础设施，再同步清单和文档。

## App Composition

`app/composition` 是唯一实现选择点。`AppServices` 当前注入 `projects: ProjectRepository`：

- 开发默认动态加载内存 Repository；延迟由构造参数注入，测试不依赖环境变量特判。
- 开发设置 `VITE_PROJECT_ADAPTER=pr57-candidate` 时才加载 PR #57 候选 HTTP Repository。
- 生产组合在正式 OpenAPI 到位前注入不可用 Repository，不装配 Mock 或候选接口。
- 开发种子模块只从开发组合入口加载，生产产物不得包含种子数据。

## Capabilities

Capability 表示“前端调用一个外部业务能力”，不是有 ID 和生命周期的数据，也不是 UI Feature。

- `image-generation`：公开图片生成 Port、业务输入/结果和服务工厂。生产 runtime 拒绝 Mock；真实
  Generation OpenAPI 未冻结前不猜测 URL 或 DTO。
- `image-upload`：公开上传 Port、服务工厂和真实 HTTP Adapter。Adapter 处理支持格式、大小上限、
  multipart 以及 `{ url }` 响应映射。

页面和 Feature 只能从 `@/capabilities/<slice>` 进入，不能直接导入内部 Adapter。Mock 只能由 app
开发组合或测试选择，生产代码不得运行时降级。

## Entities

外部统一这样使用：

~~~ts
import { createWorkflowRun, getCurrentRevision } from '@/entities'
import type { ProjectRepository, Task } from '@/entities'
~~~

- `project`：Project 领域形状、异步 Repository Port、候选 HTTP Repository 和 React 查询 Hook。
  图片上传不属于 Project。
- `character`：Character、Outfit、Action、Frame。Character 不反向保存 WorkflowRun 定位字段。
- `task`：后端异步任务快照、事件和尚未冻结的订阅入口。
- `provider-session`：Provider 描述、凭据模式和短期会话形状；Generation Feature 只消费它。
- `workflow-run`：前端 WorkflowRun、Revision、五节点、命令、门禁和本地 Repository。
- `action-template`、`wearable`：资产库数据形状和待后端冻结的查询签名。

`Task` 不含 run、revision 或 node。前端专用 `WorkflowTaskLink` 留在 WorkflowRun，只保存 `taskId`、
`runId`、`revisionId` 和 `nodeId`。两者不能合并成一个后端 Task 形状。

Character 契约继续区分：

- 动作模板：`ActionTemplate`、`actionTemplateId`。
- 角色母版：`candidateCharacterTemplates`、`characterTemplateUrl`、`confirmCharacterTemplate`。
- 多方向基准帧：`baseFrames`，不使用 template 命名。
- Action 自带 `fps`；Frame 顺序由 `Action.frames` 数组表达，不重复保存 `index`。

## Pages 与 Features

Page 读取 Router 并组合模块。`workflow-editor/editor` 和 `playtest/inspection-preview` 是页面内部模块，
不读取 Router，外部只能从各自目录根进入。

Feature 表示用户操作，Feature 之间不互相导入。规划子目录可用 README 说明职责，但不得用占位代码
返回假成功。Generation 的 `provider-connection` 只负责配置与展示，不拥有 ProviderSession 数据形状。

## Shared

- `shared/api`：只处理真实 HTTP、响应壳、通用错误和 multipart；不含业务 Mock，也不承载
  WorkflowRun。
- `shared/pagination`：与传输协议无关的 `PageQuery` 与 `Paged<T>`。
- `shared/hooks`：跨 Entity 复用的异步 React 状态。
- `shared/ui`：无业务含义且已经实际使用的 UI。

不建立含义宽泛的 `shared/lib`，也不保留生产代码可导入的 `shared/testing`。

## 测试

架构测试使用 TypeScript AST 检查依赖方向、同层 Slice 隔离、公开入口、Router 隔离、Mock 引入、
直接网络请求、循环依赖以及完整一级目录清单。行为测试覆盖 Project Repository 注入、生产组合护栏、
Quick Start 项目归属、WorkflowRun 存储回退与完整校验、Revision、节点重启和 Playtest 门禁。
