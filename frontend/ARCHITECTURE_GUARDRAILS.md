# Frontend Architecture Guardrails

> 本文是当前前端架构的唯一总则。历史方案只用于追溯，不得覆盖本文与现有代码。

## Code Layers

```text
app -> pages -> features -> entities -> shared
                  |
                  +-> workflow-controller -> entities
```

- `app` 只组装真实 API、共享 Controller、路由和全局外壳。
- `pages` 负责一个路由场景，不定义后端 DTO 或第二套业务状态。
- `features` 负责可复用的用户行为，例如审核、发布和下载包。
- `features` 不依赖 `pages` 内部类型；需要共享的只读模型由 Feature 自己声明结构边界。
- `workflow-controller` 是创作运行、节点推进和异步结果写回的唯一入口。
- `entities` 保存领域类型、实体 API 契约及其 DTO 转换。
- `shared` 只保存通用 HTTP、分页、UI、Hook 和工具，不能理解 Windup 业务词汇。

## State Ownership

`WorkflowRun` 和 `WorkflowNode` 是 Quick Start 与 Workflow Editor 共用的唯一流程状态，不再套一层 `Step`。标准主链包含角色设定、角色母版、动作首帧、生成方式选择、完整动作和审核六类节点；新增动作时在同一个 Character 的同一个 WorkflowRun 内追加动作分支。节点间的边由 `dependsOnNodeIds` 保存，画布和 URL 中的 `nodeId` 只控制显示与聚焦，不能决定业务是否可推进。

节点推进规则归前端 `WorkflowController`，后端只持久化完整 WorkflowRun 快照。保存时前端携带已知 `expected_version`；后端必须在一次原子操作中校验并递增版本，冲突返回 `409`，不能静默覆盖较新的运行记录。刷新恢复时，角色图与完整动作都通过同一 `GenerationApis.get/subscribe` 继续查询；完整动作结果必须保留全部帧，不能降级成首帧。

## Product Boundaries

- `AssetLibrary` 只展示已形成可播放动作的 `Character -> Outfit -> Action -> Frame` 资产树。后端尚未提供正式发布状态前，前端统一通过 `isPublishedCharacter` 隔离创建流程中的草稿角色。
- `History` 是延期能力。正式历史/版本接口出现前只保留只读页面边界，不能根据当前 WorkflowRun 快照伪造版本记录；它与资产库不能互相改名或合并。
- `Review` 在创作流程中做通过或回推决定，会改变 WorkflowRun。
- `Playtest` 只检查已发布资产，问题记录不会反向修改工作流或角色数据。
- `Publish` 把审核通过的结果写入资产并进入 Playtest。
- `ExportPackage` 只在 Playtest 中下载 Sprite Sheet 和清单文件，不等于发布。

## Backend Boundary

页面和 Feature 不直接 `fetch`。通用传输逻辑在 `shared/api`；项目、角色、生成和媒体 DTO 分别在对应 `entities/*/api.ts` 映射。后端没有的能力不得用本地假成功、假 ID 或“跳过步骤”代替；前端可以先定义可替换契约和显式未配置错误。开发 Mock 只能由开发入口显式装配，生产构建不得回退 Mock。

## Review Checklist

- 是否复用了同一个 WorkflowController，而非在页面创建状态机？
- 是否区分资产库、历史、审核、预览、发布和下载？
- 是否由实体 API 隔离了后端字段与前端领域类型？
- WorkflowRun 保存是否携带版本，并把后端 `409` 暴露为可处理的并发冲突？
- 是否覆盖失败、刷新恢复、重复提交和终态转换？
