# Windup 前端架构 v3

本文记录导师 2026-07-28 确认的目标架构及当前前端落地状态。目标合同与当前后端可调用能力必须分开：
WorkflowRun 后端落库、Character 整树更新和三类 Task 是已确认的产品/领域方向，但不表示 PR #64
已经提供了所有对应 HTTP 路由。

## 1. 当前基线

- 前端：React + Vite + TypeScript + Tailwind CSS。
- 后端代码基线：PR #64 head `975c594`。
- 当前唯一已接通的真实业务 HTTP 能力是图片上传：
  `POST /media/upload?category=reference-image`。
- Preview/开发通过与正式 Port 同形的异步内存 Mock 走通页面入口和工作流推进。
- Production 未配置的能力明确失败，不导入开发 Mock，也不在真实请求失败后回退 Mock。
- 仓库根目录的 `project-api.md` 已确认错误，不再作为前端契约来源。

## 2. 分层

```text
app -> pages -> features -> application -> capabilities -> entities -> shared
```

| 层 | 职责 |
|---|---|
| app | 启动、路由、全局布局和服务装配 |
| pages | 路由参数、页面临时状态与模块组合 |
| features | 面向用户的生成、设置、审核、导出等操作 |
| application | 跨页面、跨能力的 UI 无关用例 |
| capabilities | 图片生成、上传等外部能力 Port |
| entities | 有身份和生命周期的数据及 Repository |
| shared | 无业务语义的网络、分页、Hooks 和 UI 基础 |

依赖规则：

1. 只能向下依赖，不允许反向依赖。
2. 同层 Page、Feature、Application、Capability Slice 互不导入。
3. 跨 Slice 只从根 `index.ts(x)` 进入；Entity 统一从 `@/entities` 使用。
4. Page、Feature 和 Entity 不直接调用 `fetch`。
5. Mock 只由 app 的开发组合注入，不能写死在页面或 Port 中。
6. 后端尚未冻结的能力只保留 Port/类型，不猜 URL、响应壳或成功数据。

当前一级目录：

- pages：asset-library、home、not-found、playtest、project-detail、projects、quick-start、workflow-editor。
- features：character-setup、export、generation、review。
- application：production-engine、workflow-controller、workflow-restart。
- capabilities：image-generation、image-upload。
- entities：action-template、character、media、playtest-inspection、project、task、workflow-run。
- shared：api、hooks、pagination、ui。

## 3. 一套内在流程，两套独立界面

Quick Start 与传统 Workflow 的业务顺序一致，但控制方式和显示内容完全不同：

- Quick Start 是自然语言/参考图入口，由 Agent 连续推进并隐藏节点、Revision 和专业参数。
- Workflow Editor 逐步展示页面节点，等待用户确认后再推进下一步。
- 两者共用 UI 无关的 `WorkflowControllerPort` 和同一种 WorkflowRun，不共用彼此的页面 UI。
- Quick Start 不得使用 `quick-start` 等伪 Project ID；启动时创建真实形状的 Project 与 WorkflowRun。

标准节点顺序：

```text
character-setup
-> character-template
-> template-candidate
-> action-setup
-> first-frame
-> complete-animation
-> review
-> export
```

该顺序只由 `WORKFLOW_NODE_ORDER` 定义。一个 Revision 的实际顺序以 `nodes` 数组位置为准，节点不重复
保存 `order`。手动编辑器调用 `advance` 一次推进一步；Quick Start 调用同一个 Controller 连续推进。

## 4. WorkflowRun 归属与持久化

WorkflowRun 是后端持久化的业务资源，前端负责推进其页面流程。这两个责任不冲突：

```text
前端 WorkflowController 决定下一步
        -> WorkflowRunRepository.save
        -> 后端持久化 WorkflowRun/Revision 快照
```

页面不直接改 Repository 快照；状态变化由 Application 用例完成。Repository 只提供异步
`create/get/save`，不执行中断、生成、重启或命令。

WorkflowRun 状态为：

```text
active | interrupted | completed | failed
```

`interrupted` 表示用户主动停止前端自动推进，已有 Revision 仍保留；它不等于失败，也不证明远端 Task
已经停止。重新开始会追加 Revision，不覆盖旧历史。

### 已有角色加动作

项目详情为已有角色添加动作时，必须先创建 `purpose: 'add_action'` 的 WorkflowRun，并预填：

- `characterId`
- `outfitId`
- `characterTemplateUrl`
- `baseFrameUrls`

该分支从 `action-setup` 开始，避免用户重新走角色母版流程。`CreateWorkflowRunInput` 使用判别联合，
四项缺一时不能形成合法的 add_action 输入。

## 5. Character 整树

Character 是前端聚合根：

```text
Character
└─ Outfit
   └─ Action
      └─ Frame[]
```

后端目标以单条 Character 记录和 `character_data` JSONB 保存整棵树。前端相应只定义：

- `CharacterReader.get/listByProject`：只读查询，Playtest 仅依赖它。
- `CharacterRepository.create/update`：创建以及整棵 Character 更新。

确认母版、添加动作、更新帧都先产生新的 Character 整树，再调用 `update(character)`；不并存
`confirmTemplate`、`addAction` 等局部后端写合同，避免未来真实接口接入时逐处重写。

概念命名保持清楚：

- 动作模板：`ActionTemplate`、`actionTemplateId`。
- 角色候选母版：`candidateCharacterTemplates`。
- 用户选定母版：`characterTemplateUrl`。
- 多方向基准帧：`baseFrames`，不使用 template 命名。
- Action 必须归属具体 Outfit。

PR #64 已采用 Character JSONB 方向，但真实路由、DTO 和缺失字段仍未闭合；前端不以默认值掩盖差异。

## 6. Task 粒度与生成边界

Task 是后端异步任务快照，不等于 WorkflowRun 节点，也不按底层某一次模型调用划分。

固定 TaskType：

```text
character_template | first_frame | complete_animation
```

- `character_template`：生成角色母版候选。
- `first_frame`：生成动作首帧。
- `complete_animation`：生成完整动画；内部即使多次模型调用，对前端仍是一个 Task。

`ImageGenerationPort.submit` 返回 `Promise<Task<T['type']>>`；`TaskRepository.get` 返回运行时校验过的
封闭 `TaskType`，不能把任意字符串当合法任务。Task 不保存 run、revision 或 node，这些关联由
`WorkflowTaskLink` 单独表达。

`ProductionEnginePort` 屏蔽任务提交、等待和结果解析。页面不直接使用 TaskRepository 或
TaskEventSource。PR #64 仍未提供符合上述三类任务的完整 HTTP/SSE 契约，因此当前只有 Port 与
Preview/开发 Mock，不声称真实 Adapter 已接通。

## 7. Playtest

Playtest 只做核验，没有修改能力。独立入口为：

```text
/playtest/:characterId/:outfitId?actionId=:actionId
```

`characterId + outfitId` 是必填播放目标，`actionId` 仅用于可选动作定位。从 Workflow 进入时还可携带
`runId + revision` 作为返回来源，但二者不是独立播放前置条件。

Playtest 通过 `CharacterReader` 只读 Character→Outfit→Action→Frame。核验结论“通过 / 发现问题”
保存到独立 `PlaytestInspectionRepository`，不修改 Character、WorkflowRun、Revision 或生成产物。
PR #64 尚未提供该记录的正式 HTTP 接口。

## 8. App Composition

`app/composition` 是唯一实现选择点。`AppServices` 当前包含：Project、Character、WorkflowRun、Image
Generation、Task、Task Event、Image Upload、Quick Start、Production Engine、Workflow Restart、
Workflow Controller 和 Playtest Inspection。

- Preview/开发：异步内存 Repository 和能力 Mock，用于页面开发、恢复路径和行为测试。
- Production：图片上传使用真实 Adapter，其余未接通能力明确失败。
- 页面只接收所需的最窄接口，例如 Playtest 接收 `CharacterReader` 而不是 CharacterRepository。
- Port 不公开 `real/mock/unconfigured` 字段。

## 9. 路由

```text
/                                      模式选择
/quick-start                           Quick Start 输入
/quick-start/:runId                    Quick Start 独立创作台
/projects                              项目列表
/projects/:projectId                   项目详情
/projects/:projectId/assets            项目资产库
/workflow-editor/:runId                当前 Revision 工作流
/workflow-editor/:runId/:stage         指定工作流节点
/playtest/:characterId/:outfitId        独立核验台
```

资产库是项目内 Character 与 ActionTemplate 的前端聚合页面名，不表示后端存在统一 Asset 实体。
Wearable 当前暂缓；Outfit 继续保留。

## 10. 当前已实现与待接入

已实现：

- 七层目录、依赖边界和唯一 app 装配入口。
- WorkflowRun/Revision/八节点类型、Repository Port 和 UI 无关 WorkflowController。
- Quick Start、Project 加动作和 Workflow Editor 的 Preview/开发路径。
- CharacterReader、CharacterRepository 整树更新合同。
- 三类 TaskType、图片生成 Port、Task Repository 与事件 Port。
- 图片上传真实 HTTP Adapter。
- Playtest 的 Character+Outfit 独立入口、只读角色树和独立核验记录。
- Preview/开发异步 Mock 与 Production 明确失败隔离。
- Quick Start 会话可恢复状态且只中断 `active` 运行；Preview 在 Review/Export 未配置时停住，不写伪成功。

仍待真实后端或正式契约：

- Project、Character、WorkflowRun 的 HTTP Repository/Adapter。
- 三类 Generation/Task 查询、取消、结果 DTO 与 SSE。
- Review、Export、ActionTemplate、PlaytestInspection 等接口。
- Character 缺失字段、Action 来源、Outfit 参数、候选数量等前后端映射缺口。

前端补代码时只能在这些稳定 Port 后新增实现，不得让页面拼 URL，也不得把未落地的 PR #64 能力写成
“已经接通”。

## 11. 测试重点

1. 分层方向、Slice 隔离、公开入口和循环依赖。
2. Quick Start 与手动编辑器共用 Controller，但保持独立 UI。
3. `add_action` 输入四项预填不变量。
4. TaskType 只能是三个前端可见异步步骤。
5. Playtest 必须 Character+Outfit、只读 Character、独立保存核验结论。
6. Preview/开发 Mock 与 Production 隔离，真实请求失败不降级。
7. 图片上传的 URL、multipart、响应映射和错误处理。
