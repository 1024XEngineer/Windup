# Windup 前端模块契约

完整架构以根目录 [frontend-architecture-v3.md](../frontend-architecture-v3.md) 为准；本文记录当前代码
模块的公开边界。

## 分层与依赖

~~~text
app -> pages -> features -> application -> capabilities -> entities -> shared
~~~

代码只能向下依赖。同层 Page、Feature、Application 和 Capability Slice 不得互相导入；跨 Slice 只能从目录根
`index.ts(x)` 进入。Entity 作为一个数据模块，对上层只公开 `@/entities`。`shared` 不认识业务概念。

当前一级模块清单由架构测试锁定：

| 层 | 允许的一级模块 |
|---|---|
| pages | asset-library、home、not-found、playtest、project-detail、projects、quick-start、workflow-editor |
| features | character-setup、export、generation、review |
| application | production-engine、workflow-controller、workflow-restart |
| capabilities | image-generation、image-upload |
| entities | action-template、character、media、playtest-inspection、project、task、workflow-run |
| shared | api、hooks、pagination、ui |

新增一级目录必须先明确它是页面、用户操作、外部能力、实体还是通用基础设施，再同步清单和文档。

## Application

`application/production-engine` 屏蔽底层 Task 生命周期；`application/workflow-controller` 是 Quick Start
和手动 Workflow 共用的界面无关推进边界；`application/workflow-restart` 只负责从历史节点
创建新执行线。Preview/开发已提供 Mock 实现，生产组合继续明确失败。

取消的稳定上层边界是 `ProductionEnginePort.cancelAttempt(target)`。未来实现必须先使该精确
attempt 在前端失效，再通过 ImageGeneration Adapter 的 `AbortSignal` 和已关联的
`TaskRepository.cancel(taskId)` 尽力请求远端取消。不论后端取消是否成功，迟到结果都不得写回。

## App Composition

`app/composition` 是唯一实现选择点。`AppServices` 当前为所有已冻结端口保留位置：

- `projects: ProjectRepository`
- `characters: CharacterRepository`
- `workflowRuns: WorkflowRunRepository`
- `imageGeneration: ImageGenerationPort`
- `tasks: TaskRepository`
- `taskEvents: TaskEventSource`
- `imageUpload: ImageUploadPort`
- `quickStart: QuickStartService`
- `productionEngine: ProductionEnginePort`
- `workflowRestart: WorkflowRestartPort`
- `workflowController: WorkflowControllerPort`
- `playtestInspections: PlaytestInspectionRepository`

- 错误的 Project API 已停用，不再支持 `VITE_PROJECT_ADAPTER=http`。
- `imageUpload` 使用 PR #64 head `975c594` 的真实上传 Adapter。Preview/开发对其他能力使用
  同 Port 内存 Mock；Production 使用明确失败的未配置实现。
- Port 不暴露 `adapterKind`；real/mock/unconfigured 只属于 app 装配实现。
- Mock 只从 `app/composition/development` 装配，不会在真实请求失败后偷偷降级。

上传 Adapter 读取 `VITE_API_BASE_URL`；空值表示同源，不自动添加 `/api`，也不猜默认后端端口或
Vite 代理。PR #64 当前未注册 CORS middleware，分端口直连时需后端 CORS 或外部反向代理。

Quick Start 页面只注入页面所属的 `QuickStartService`，通过 `getSession` 读取会话级状态且只中断
`active` 运行；该契约位于 `pages/quick-start/model`，不再重复建立同名 Feature Slice。
Workflow Editor 注入只读 `WorkflowRunReader`、Production Engine、
Workflow Restart 和上传 Port；原始 `ImageGenerationPort` 留在 app 装配层，供未来构造 Production Engine，
不允许页面绕过制作引擎直接调用。

## Capabilities

Capability 表示“前端调用一个外部业务能力”，不是有 ID 和生命周期的数据，也不是 UI Feature。

- `image-generation`：只公开图片生成提交 Port 和业务输入/结果类型；泛型 `submit` 返回与输入 `type`
  字面量一致的独立 `Task<T['type']>`。Preview/开发由 app 组合注入 Mock，真实 Adapter 尚未接通。
- `image-upload`：公开上传 Port 和真实 HTTP Adapter。Adapter 固定调用
  `POST /media/upload?category=reference-image`，以 `multipart/form-data` 的 `file` 字段上传
  `image/*`，并只将成功响应的 `data.url` 转为 `MediaReference`。

上传返回不透明 `MediaReference`，生成输入使用 `referenceMedia`。即使当前值来自 `data.url`，调用方也
不能依赖 URL 结构、`object_key`、文件名、content type 或 size。
PR #64 中 Media CRUD 和通用加工仍被导师质疑，因此前端不定义 MediaRecord、Repository 或 Processor。

页面和 Feature 只能从 `@/capabilities/<slice>` 进入，不能直接导入内部 Adapter。Mock 只能由 app
开发组合或测试选择，生产代码不得运行时降级。

## Entities

外部统一这样使用：

~~~ts
import { WORKFLOW_NODE_ORDER } from '@/entities'
import type { ProjectRepository, Task, WorkflowRunRepository } from '@/entities'
~~~

- `project`：Project 领域形状、异步 Repository Port 和 React 查询 Hook。当前没有 HTTP Repository；
  图片上传不属于 Project。
- `character`：Character、Outfit、Action、Frame 和整树 `create/update` Repository。Character 不反向保存
  WorkflowRun 定位字段；确认母版、加动作和改帧都通过完整 Character 更新，不另立局部写合同。
- `task`：后端异步任务快照，粒度由前端可见步骤定义：`character_template | first_frame |
  complete_animation`。`Task` 不允许任意 string 类型；完整动画内部的多次模型调用不会裂成多个前端 Task。
- `workflow-run`：前端推进、后端持久化的 WorkflowRun、Revision、八节点、命令形状和异步 Repository Port。
  节点类型的标准顺序只由 `WORKFLOW_NODE_ORDER` 定义，具体 Revision 的节点顺序
  只由 `WorkflowRevision.nodes` 数组位置表达；`WorkflowNode` 不保存 `order`。Repository 只做
  `create/get/save`，不执行流程命令或重启。WorkflowRun 状态为
  `active | interrupted | completed | failed`；`interrupted` 表示用户主动停止且保留历史，不等于失败或完成。
  `add_action` 创建输入必须同时预填 `characterId`、`outfitId`、`characterTemplateUrl` 和
  `baseFrameUrls`，使已有角色可从动作资料阶段恢复，不重新执行角色母版流程。
- `media`：只公开不透明 `MediaReference`，不猜测 PR #64 的上传、记录或加工 DTO。
- `action-template`：保留系统/项目模板的前端领域形状；真实查询接口待冻结。
- `playtest-inspection`：按 Character+Outfit 保存独立核验记录；Workflow 来源只是可选返回定位。

Wearable 按导师意见暂缓，当前没有 Entity、Repository 或页面数据入口。Outfit 是角色造型层，不是
Wearable，继续保留；Action 必须通过 `outfitId` 归属某个 Outfit。
`Outfit.actions` 是 Character JSON 树的一部分，前端整树读取和更新；后端内部如何组织表结构仍可独立
演进。`ActionType` 只在 Character Entity 定义一次，Generation 直接复用，避免两个模块维护重复枚举。

Action 同时保留两个正交字段：`kind` 表示定义来源方式（preset/custom），`type` 表示动作业务语义
（walk/idle/attack/jump/custom）。例如 custom 来源可以定义 walk，preset 来源也可以承载 custom
业务语义。`AddActionInput` 的 preset/custom 两个分支都必须同时携带 `kind` 与 `type`；preset 另外必须
携带 `actionTemplateId`。创建输入不能只给来源而省略业务语义，也不能用 `type` 替代 `kind`。
PR #64 CharacterAction 当前没有
来源字段，真实后端读取后无法恢复 kind，这是待对齐缺口。前端不为此向 Action 读取形状猜测
actionTemplateId、模板版本或 prompt snapshot，也不实现 Adapter、Mock 或 HTTP 映射。

`Task` 不含 run、revision 或 node。前端专用 `WorkflowTaskLink` 留在 WorkflowRun，只保存 `taskId`、
`runId`、`revisionId` 和 `nodeId`。两者不能合并成一个后端 Task 形状。
页面不直接使用 Task Repository 或 Event Source；Production Engine 在 Application 层将
Task 生命周期转换成对上的 `GenerationResultFor<T>`。

Character 契约继续区分：

- 动作模板：`ActionTemplate`、`actionTemplateId`。
- 角色母版：`candidateCharacterTemplates`、`characterTemplateUrl`；确认动作通过 Character 整树更新表达。
- 多方向基准帧：`baseFrames`，不使用 template 命名。
- Frame 可读取逐帧 `durationMs` 与结构化 `rootMotion { dx, dy }`。时长单位为毫秒；位移单位为 px，
  相对动作首帧，y 向上为正；相应 null 分别表示使用 `Action.fps` 等时长回退和不施加位移。
- Action 自带 `fps`，但它只在 Frame.durationMs 缺失时提供等时长回退；`keyFrameIndex` 是 frames 内的
  零基下标或 null，可标记攻击触点、跳跃顶点等关键时刻。Frame 顺序仍由数组表达，不重复保存 `index`。

以上动画字段是 Issue #63 讨论中的前端领域读取骨架，不表示后端 DTO 或 OpenAPI 已冻结。Playtest 和
Export 只读消费这些字段；不通过 Playtest 修改 Character，也不据此猜测 HTTP Adapter。

## Pages 与 Features

Page 读取 Router 并组合模块。`workflow-editor/editor` 和 `playtest/inspection-preview` 是页面内部模块，
不读取 Router，外部只能从各自目录根进入。

Playtest 通过 `CharacterReader` 只读 Character→Outfit→Action→Frame 树，可独立保存“通过 /
发现问题”核验结论；它不修改 WorkflowRun、Revision、Character 或产物。

Feature 表示用户操作，Feature 之间不互相导入。规划子目录可用 README 说明职责，但不得用占位代码
返回假成功。Generation 只面向图片生成能力，不选择 Provider，也不维护 Provider Session。

控制接口不重叠：Quick Start interrupt 立即停止后续自动决策，并要求当前精确 attempt 失效；
Production Engine cancelAttempt 保证该 attempt 不再写回，并尽力请求远端取消；
Workflow Restart 创建新执行线；Repository 只存取。Review、Asset、Export 的后端 Port 等正式
OpenAPI 后再定义；当前 PlaytestInspectionRepository 只表达已确认的独立记录业务边界。

PR #64 当前没有 Generation/Task cancel 路由或方法。Quick Start 和 Production Engine 仍保留
“精确 attempt 本地失效 + 远端 best-effort cancel”的上层语义，但当前没有远端取消 Adapter；后端
补齐能力时不需要改页面接口。
后端 Task 的停止结果不决定 WorkflowRun 状态：用户中断后即可记为 `interrupted`；未来从保留的历史
重启成功时，WorkflowRun 可重新进入 `active`。

Generation 当前按导师 07-28 最新口径定义角色模板、首帧、完整动画三类输入和结果；
不复用一个带自由 metadata 的通用结果。后端 Character Image 输入的 `num_images` 与单个
`image_url` 输出尚未闭合，Character Action 输入又缺 `outfit_id`，因此不生成 Adapter。

Project 当前只有 ORM/ABC，数字枚举映射未知；Character 以单表加 `character_data` JSONB 持久化，
与前端领域模型保持分离。后端形状缺少前端的 `name`、`Action.kind`、候选母版、`baseFrames`、质检信息、
`rootMotion`、`keyFrameIndex`；后端 `ActionType` 还缺 `jump` 且一处使用裸 `str`。这些差异不在页面或
Entity 中用默认值补齐。SSE 目前也只有文档描述，没有可注册的 `TaskEventSource` 实现。

Workflow Editor 的 `candidate` 是独立“候选选择”页面，位于 `generation` 与 `review` 之间。
Generation 产出候选，后端系统质检只提供候选质量信息或过滤依据；手动 Workflow 由用户选择，
Quick Start 复用同一内在选择边界并由 AI 自动选择，因此不展示该页面。candidate 只产出所选候选的
身份或引用，不表示审核通过；Review 继续检查已选结果。Preview/开发只提供可替换的 Mock 推进；真实
选择算法、质检和 HTTP Adapter 仍待契约。

## Shared

- `shared/api`：承载图片上传 Adapter 使用的真实 transport；当前不绑定 Project、Generation、Task
  或 SSE，也不承载 WorkflowRun。后端异常处理器尚未挂到 app，因此 transport/Adapter 兼容统一错误壳
  与 FastAPI 默认 `detail` 等非统一错误，解析失败不能变成假成功。
- `shared/pagination`：与传输协议无关的 `PageQuery` 与 `Paged<T>`。
- `shared/hooks`：跨 Entity 复用的异步 React 状态。
- `shared/ui`：无业务含义且已经实际使用的 UI。

不建立含义宽泛的 `shared/lib`，也不保留生产代码可导入的 `shared/testing`。

## 测试

架构测试使用 TypeScript AST 检查依赖方向、同层 Slice 隔离、公开入口、Router 隔离、生产 Mock 引入、
直接网络请求、循环依赖以及完整一级目录清单。Preview/开发允许通过 app 组合注入同契约异步 Mock，
但页面不得内置实现，Production 也不得导入或在失败后回退 Mock。行为测试还覆盖真实图片上传 Adapter 的 URL、multipart、
响应映射、错误解析及“不回退 Mock”边界。
