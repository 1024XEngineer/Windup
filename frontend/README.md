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

PR #64 head `975c594` 的图片上传已通过 `ImageUploadPort` 接入真实 Adapter；Project、Character、
WorkflowRun、Generation、Task 和 SSE 尚无可调用 HTTP 路由。Preview/本地开发通过同一异步 Port
注入内存 Mock，使核心入口可走通；Production 仍明确失败，不回退 Mock。

`VITE_API_BASE_URL` 留空时上传走同源，不会自动追加 `/api`。PR #64 当前未注册 CORS middleware；
前后端分端口开发若直接配置跨域地址，需要后端 CORS 或外部反向代理，前端不猜代理或默认端口。

## 路由

- `/`：选择 Quick Start 或从项目开始。
- `/quick-start`：自然语言与参考图入口；Preview/开发组合会创建 Project 与 WorkflowRun。
- `/quick-start/:runId`：Quick Start 独立创作台，隐藏节点与版本术语。
- `/projects`：项目列表。
- `/projects/:projectId`：项目详情。
- `/projects/:projectId/assets`：项目资产库。
- `/workflow-editor/:runId`：当前 Revision 的工作流入口。
- `/workflow-editor/:runId/:stage`：当前 Revision 的指定节点。
- `/playtest/:characterId/:outfitId?actionId=:actionId`：独立核验台；`runId/revision`仅作可选来源定位。

## 分层

~~~text
app -> pages -> features -> application -> capabilities -> entities -> shared
~~~

- `app`：启动、Router、全局布局、错误边界和真实/开发实现组合。
- `pages`：路由、URL、页面临时状态和模块组合。
- `features`：生成、角色设置、审核、导出和 Quick Start 等用户操作。
- `application`：跨能力的制作用例契约；`workflow-controller` 是两个入口共用的界面无关推进边界。
- `capabilities`：调用外部能力的稳定 Port；图片上传已有真实 Adapter，图片生成仍只有契约。
- `entities`：Project、Character、MediaReference、PlaytestInspection、Task、WorkflowRun 等有身份或生命周期的数据。
- `shared`：供图片上传 Adapter 使用的 HTTP transport、通用分页、React hooks 和无业务 UI。

跨 Slice 只能走目录根 `index.ts(x)`。上层使用 Entity 时统一从 `@/entities` 进入。Page、Feature
和 Entity 不直接调用 `fetch`；HTTP Adapter 经 `shared/api` 发请求。

## 一套制作流程，两种控制方式

Quick Start 与手动 Workflow 共用同一种 WorkflowRun、Revision 和八个有序节点：
`character-setup`、`character-template`、`template-candidate`、`action-setup`、`first-frame`、
`complete-animation`、`review`、`export`。手动模式每次推进一步；Quick Start 连续调用同一
`WorkflowControllerPort`。两个页面仍完全独立，只共享界面无关逻辑。

节点类型的标准顺序只由 `WORKFLOW_NODE_ORDER` 定义；某个 Revision 已进入执行线的实际顺序只由
`WorkflowRevision.nodes` 数组位置表达。`WorkflowNode` 不重复保存 `order`；Preview/开发的
`WorkflowControllerPort` 按该顺序推进，页面不各自复制状态机。

`generation` 产出候选；独立的 `candidate` 在界面中显示为“候选选择”。后端系统质检仅作为候选的
质量信息或过滤依据，不是该页面的名称，也不替代选择。手动 Workflow 由用户选择，Quick Start 走同一
内在选择逻辑但由 AI 自动选择并隐藏页面。该阶段只产出所选候选的身份或引用；`review` 仍负责检查
已选结果，选择本身不等于人工审核。Preview/开发组合只提供可替换的异步 Mock 推进；真实选择算法、
质检和 HTTP Adapter 仍待正式契约。

Quick Start 通过页面所属的 `QuickStartService` 创建真实形状的 Project 与 WorkflowRun，禁止使用 `quick-start`
一类伪 ID。Preview/开发组合会连续调用同一个 `WorkflowControllerPort`；生产组合未接通时明确失败。
会话页通过 `getSession` 恢复状态，只在运行仍为 `active` 时提供中断；没有 Review/Export 结果时停在
对应阶段，不伪造完成或已导出。
未来中断实现必须立即停止后续自动决策，并使当前精确生成 attempt 在前端失效；之后即使收到迟到结果，
也不得写回 WorkflowRun。此时 WorkflowRun 记为 `interrupted`：它表示用户主动停止，历史仍保留，
不等于 `failed` 或 `completed`。未来从历史重启成功后可回到 `active`。

WorkflowRun 由前端推进，但是后端持久化的业务资源。页面只通过异步
`WorkflowRunRepository.create/get/save` 读写；Preview Mock 与未来真实 HTTP Adapter 共用这一形状，
不用 localStorage。新建角色与已有角色加动作通过 `purpose` 区分，后者预填 Character/Outfit/母版/基准帧。
后端 Task 是否真正停止与 WorkflowRun 是否记为 `interrupted` 是两个独立问题。

## 外部能力边界

- Project 页面只依赖异步 `ProjectRepository`。Preview/开发使用同契约内存实现，Production 在正确
  OpenAPI 冻结前明确失败；Quick Start 使用页面所属的 `QuickStartService`。
- 图片生成位于 `capabilities/image-generation`。`submit` 只提交异步生成并返回 Task，
  不伪装成立即拿到最终结果；泛型返回值保留输入的 `type` 字面量，固定使用角色母版、首帧、完整动画
  三套判别输入/结果。
- 图片上传位于 `capabilities/image-upload`，由 `AppServices.imageUpload` 注入真实 HTTP Adapter。
  Adapter 调用 `POST /media/upload?category=reference-image`，以 multipart 的 `file` 字段上传
  `image/*`，只读取成功响应的 `data.url`。
- 上传向上返回不透明 `MediaReference`，生成输入使用 `referenceMedia`；调用方不依赖 URL 结构、
  `object_key`、`filename`、`content_type` 或 `size`。不增加 Media CRUD、Repository 或 Processor。
- 后端异常处理器当前未挂到 app；上传会兼容统一错误壳与 FastAPI 默认 `detail` 等非统一错误并明确失败。
- Quick Start 中断、单次生成取消、流程重启和 WorkflowRun 存取分别由四个边界负责，页面不能绕过
  Application 用例直接提交状态命令。
- Production Engine 取消时先保证精确 attempt 不再可写回，再通过 ImageGeneration Adapter 的
  `AbortSignal` 和 `TaskRepository.cancel(taskId)` 尽力请求远端取消。
- `Task` 是独立 Entity，粒度跟前端可见异步步骤走：`character_template`、`first_frame`、
  `complete_animation`。完整动画内部可多次调用模型，对前端仍是一个 Task。
  `TaskRepository.get` 返回经运行时校验的封闭 `TaskType`，不再放行任意 `string`。
- PR #64 当前没有 Generation/Task 取消路由或方法。Quick Start 与 Production Engine 仍保留
  “本地使精确 attempt 失效 + 远端 best-effort cancel”的上层语义，但当前没有远端取消 Adapter。
- `WorkflowTaskLink` 只负责把后端任务映射到前端 WorkflowRun 节点。Production Engine 未来在内部等待任务并对上返回最终生成结果。
- 前端不定义 `providerId` 或 Provider Session；具体生成方、模型和凭据由后端能力内部决定。
- Generation、Review、Export 等未接通能力会明确保持未实现，不返回伪造成功。
- Review、Asset、Export 没有正式 OpenAPI，因此本轮不新增后端调用 Port；Playtest 仅保留独立核验记录 Repository。
- Wearable 按 PR #64 导师评论暂缓；Outfit 造型层继续保留，Action 必须归属 Outfit。
- “资产库”是前端聚合页面名称，不代表后端统一 Asset 模型已经确定。
- Playtest 必填 `characterId + outfitId`，可选定位 `actionId`。它通过 `CharacterReader` 只读播放整棵造型数据，
  独立保存“通过/发现问题”，不修改 WorkflowRun、Revision、Character 或产物。

最新后端模型仍不能直接映射前端领域：Project 只有 ORM/ABC 且数字枚举映射未知；Character 采用单表加
`character_data` JSONB，缺少前端所需的 `name`、`Action.kind`、候选母版、`baseFrames`、质检信息、
`rootMotion` 和 `keyFrameIndex`。后端 `ActionType` 没有 `jump` 且一处仍为裸 `str`；动作生成输入缺
`outfit_id`；图片生成输入有 `num_images`，输出却只有单个 `image_url`。SSE 只有文档描述，尚无实现。
这些能力在契约闭合前不新增 Adapter，也不用默认值掩盖差异。

Action 保留两个独立维度：`kind` 是定义来源方式（preset/custom），`type` 是业务语义
（walk/idle/attack/jump/custom），所以 custom + walk、preset + custom 都合法；`AddActionInput.kind`
继续保留。PR #64 CharacterAction 没有来源字段，真实后端读取暂时无法恢复 kind，属于待对齐缺口。
当前不向 Action 读取形状增加 actionTemplateId、模板版本或 prompt snapshot，也不实现 Adapter、Mock
或 HTTP。

## 动画播放读取骨架

Character Entity 为 Playtest 和 Export 预留结构化只读数据：每帧 `durationMs` 使用毫秒，null 时才按
`Action.fps` 等时长回退；每帧 `rootMotion` 使用 `{ dx, dy }`，单位 px，相对动作首帧且 y 向上为正，
null 表示不提供也不施加位移。`Action.keyFrameIndex` 是 `frames` 内的零基数组下标或 null，用于攻击
触点、跳跃顶点等关键时刻。

Issue #63 仍开放；这些字段只是前端领域读取形状，不声称后端 DTO 或 OpenAPI 已冻结。当前不实现
播放器、越界校验、数据修改、HTTP/DTO 映射或 Mock。
