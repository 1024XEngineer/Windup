# 前端 API 契约状态

本文是前端当前调用和需求签名的清单，不替代未来由后端 OpenAPI 生成的客户端。
在 OpenAPI 落地前，只有标为“已核对”的接口可以按真实后端接口联调；其余接口
不能被描述为已接通后端。独立业务能力在开发或测试中可以由 Mock transport 承载，但生产请求
仍需等待明确的后端契约。WorkflowRun 是前端编排模型，不属于后端 API 契约。

## 通用约定

- 开发环境以 `/api` 为基址；Vite 将其代理到 `http://127.0.0.1:8000`。
- 单项响应：`{ code, message, data, timestamp? }`；只有 `code === 200` 才是成功。
- 列表响应额外包含 `total`、`page` 和 `page_size`。
- 生产构建只使用真实 transport；不会回退到 Mock 数据。

## 已核对：项目与上传

以下接口的路径、方法、字段和响应壳已与后端 PR #57 对照。该 PR 尚未合并或部署，
因此它们是“可联调契约”，不是当前已验证可访问的服务。

### 项目

- `GET /projects?page=1&page_size=20&user_id=1`
- `GET /projects/{id}`
- `POST /projects`
- `DELETE /projects/{id}`

创建项目示例：

```json
{
  "user_id": 1,
  "workflow_id": null,
  "project_name": "Knight",
  "character_perspective": 1,
  "directional_movement": 1,
  "sprite_width": 64,
  "sprite_height": 64,
  "game_style": null,
  "sprite_sample_url": null
}
```

`user_id` 目前是演示值；接入认证后应由后端从令牌推导，前端不再传递它。

后端当前用数字表达视角和移动方向，前端领域层统一使用字符串枚举，数字只在 Project mapper
内转换：

```ts
type CharacterPerspective = 'side' | 'top-down' | 'isometric'
type DirectionalMovement = 'single' | 'four-way' | 'eight-way'
```

`gameStyle` 是项目级画风约束，会进入本项目的生成上下文；`sampleImageUrl` 是项目级画风
参考图，不是生成结果或角色母版。

### 参考图片上传

- `POST /upload/image`
- `multipart/form-data`，字段名为 `file`
- 允许 `image/jpeg`、`image/png`、`image/webp`、`image/gif`
- 最大 10 MiB；前端会在发起网络请求前拒绝超限文件。

```ts
const url = await uploadImage(file)
// 成功响应：{ code: 200, message: 'success', data: { url } }
```

## 前端本地编排：WorkflowRun

`WorkflowRun`、`WorkflowRevision` 和五个页面节点用于组织 Quick Start、Workflow Editor、
Playtest 与历史查看。它们由前端 `entities/workflow-run` 的本地 Repository 持久化，不经过
`shared/api`，也不存在对应的 `/workflows` 或 `/workflow-runs` 后端路径。

页面继续使用稳定的前端门面：

```ts
createWorkflowRun(input)
fetchWorkflowRun(runId)
submitWorkflowCommand(runId, command)
```

真实后端集成按照 PR #62 拆为 Project、Media、Character、Generation、Asset、Review、
Playtest 和 Export 等独立能力。其 OpenAPI 冻结后，由 WorkflowRun 编排层组合对应 Adapter；
页面不需要知道后端模块拆分，也不提前猜测未确定的路径和 DTO。

## 仅有需求签名：角色与资产

以下函数当前会明确抛出 `not implemented`，不存在真实网络调用：

- `GET /characters/{id}`、`POST /characters`
- `GET /projects/{id}/characters`
- `confirmCharacterTemplate`、`addAction`、`POST /actions/{id}/confirm`（前两项路径待定）
- `GET /projects/{id}/action-templates`
- `GET /projects/{id}/wearables`

前端禁止单独使用 `template` 表达不同业务概念：动作模板统一使用 `ActionTemplate` 和
`actionTemplateId`；角色母版统一使用 `candidateCharacterTemplates`、`characterTemplateUrl`
和 `confirmCharacterTemplate`。母版确认的后端路径同样必须包含 `character-template` 前缀，
具体资源层级仍以后端 OpenAPI 为准。母版确认后展开的多方向基准帧继续称为 `baseFrames`，
不使用 template。

```ts
interface Frame {
  imageUrl: string
  qc: 'pending' | 'passed' | 'failed'
  rejected: boolean
}

interface Action {
  id: string
  variantId: string
  fps: number
  frames: Frame[]
  sourceWorkflowRunId: string | null
}

interface CharacterVariant {
  id: string
  characterId: string
  name: string
  candidateCharacterTemplates: string[]
  characterTemplateUrl: string | null
  actions: Action[]
}

interface Character {
  id: string
  projectId: string
  name: string
  variants: CharacterVariant[]
}

interface ActionTemplateBase {
  id: string
  name: string
  prompt: string
}

type ActionTemplate = ActionTemplateBase &
  (
    | { scope: 'system'; projectId: null }
    | { scope: 'project'; projectId: string }
  )

declare function confirmCharacterTemplate(variantId: string): Promise<CharacterVariant>

declare function addAction(
  variantId: string,
  input: {
    name: string
    kind: 'preset' | 'custom'
    actionTemplateId?: string
  },
): Promise<Action>
```

即使 MVP UI 只展示一个造型，Character 也通过 `variants` 保留造型层，候选母版、选定母版与
动作都归属具体 CharacterVariant。`sourceWorkflowRunId` 是前端编排定位信息，不要求后端 Action 认识
WorkflowRun；后端可返回自己的 Task、Execution 或 Asset 引用，再由前端建立关联。前端全部
业务 ID 都是 string，后端数字 ID 只在 DTO mapper 中转换。

`Action.frames` 的数组顺序就是播放顺序，因此 Frame 不重复携带 `index`。审核和页面定位可以
临时使用 `frameIndex`；如果后端以后支持独立 Frame 资源，应另行提供稳定 ID。Action 的 `fps`
由后端返回，预览和导出不得依赖前端全局常量。

项目模板查询应返回“系统内置模板 + 当前项目自定义模板”的合集，并通过 `scope` 与
`projectId` 区分归属。系统模板不虚构项目 ID。

## 未对齐：异步任务与 SSE

任务创建、查询和断线恢复需要完整快照；流式事件使用同一组状态字段：

```ts
type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

interface Task {
  id: string
  status: TaskStatus
  progress: number | null
  error: string | null
  result: unknown
}

interface TaskEvent extends Omit<Task, 'id'> {
  taskId: Task['id']
}

interface WorkflowTaskLink {
  taskId: Task['id']
  runId: string
  revisionId: string
  nodeId: string
}
```

后端 Task 不依赖前端 WorkflowRun。`WorkflowTaskLink` 只保存在前端，用于把后端 `taskId`
映射回当前 run、revision 和 node。`result` 在具体生成产物契约冻结前保持 `unknown`。SSE 当前
只有 transport 预留，订阅地址、事件名称、断线重连、补发策略以及 Task 创建/查询接口均未与
后端对齐，前端不得把它描述为已接通能力。
