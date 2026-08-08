# Frontend Architecture Guardrails

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

`WorkflowRun` 和 `WorkflowStep` 是 Quick Start 与 Workflow Editor 共用的唯一流程状态。画布节点只由步骤投影而来；连线和 URL 中的 `stepId` 只控制显示与聚焦，不能决定业务是否可推进。刷新恢复时，角色图与完整动作都通过同一 `GenerationApis.get/subscribe` 继续查询；完整动作结果必须保留全部帧，不能降级成首帧。

## Product Boundaries

- `AssetLibrary` 展示后端已经保存的 `Character -> Outfit -> Action -> Frame` 资产树。
- `History` 展示 `WorkflowRun` 的执行与版本记录。两者不能互相改名或合并。
- `Review` 在创作流程中做通过或回推决定，会改变 WorkflowRun。
- `Playtest` 只检查已发布资产，问题记录不会反向修改工作流或角色数据。
- `Publish` 把审核通过的结果写入资产并进入 Playtest。
- `ExportPackage` 只在 Playtest 中下载 Sprite Sheet 和清单文件，不等于发布。

## Backend Boundary

页面和 Feature 不直接 `fetch`。通用传输逻辑在 `shared/api`；项目、角色、生成和媒体 DTO 分别在对应 `entities/*/api.ts` 映射。后端没有的能力不得用本地假成功、假 ID 或“跳过步骤”代替。

## Review Checklist

- 是否复用了同一个 WorkflowController，而非在页面创建状态机？
- 是否区分资产库、历史、审核、预览、发布和下载？
- 是否由实体 API 隔离了后端字段与前端领域类型？
- 是否覆盖失败、刷新恢复、重复提交和终态转换？
