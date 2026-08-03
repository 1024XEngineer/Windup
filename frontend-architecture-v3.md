# Windup 前端架构

本文只约束 `frontend/`。后端在前端视角中是外部 API 提供方；后端如何拆包、执行生成或保存数据，不属于本文范围。

## 1. 五层目录

```text
frontend/src/
├── app/       # 应用入口、路由、全局布局和依赖装配
├── pages/     # 一个目录对应一个完整路由场景
├── features/  # 跨实体的用户操作和流程协调
├── entities/  # 业务数据、API 契约和传输映射
└── shared/    # 不理解 Windup 业务的通用能力
```

依赖只能向下：`app -> pages -> features -> entities -> shared`。上层可以跳过中间层使用更低层；下层不得反向引用上层。

| 层 | 可以负责 | 不应该负责 |
|---|---|---|
| `app` | 路由、应用外壳、组装 API 和共享服务 | 业务状态机、页面业务逻辑 |
| `pages` | 组合页面、读取路由参数、处理页面状态 | 定义后端 DTO、复制 Workflow 状态机 |
| `features` | 审核、发布、导出、流程推进等用户行为 | 导入页面实现、直接定义路由 |
| `entities` | 领域类型、`XxxApis`、DTO 转换 | 页面展示、跨流程编排 |
| `shared` | HTTP、分页、通用工具和无业务 UI | Character、Playtest 等业务概念 |

## 2. 六个实体模块

目录层级不等于业务模块。当前前端冻结六个实体边界：

| 实体 | 前端职责 |
|---|---|
| `project` | 项目名称、画布规格、视角、方向和画风约束 |
| `character` | 已确认的角色、造型、动作和帧数据树 |
| `generation` | 异步生成任务的创建、读取和状态订阅 |
| `workflow-run` | Quick Start 与 Workflow Editor 共用的前端运行状态 |
| `playtest-inspection` | 每个 Playtest 目标当前最新的核验结论，不表示历史版本 |
| `media` | 上传后媒体的不透明引用和上传入口 |

`Outfit`、`Action`、`Frame` 属于 `Character`，不各建实体。`workflow-controller` 是 Feature，不是第七个实体。外部使用实体时统一从 `@/entities` 公共入口导入。

## 3. 页面与 Feature

当前产品页面范围为 `home`、`projects`、`quick-start`、`workflow-editor`、`playtest` 和 `not-found`。

- `projects` 同时承载列表、创建和详情，避免用三个顶层页面目录表达同一个路由域。
- `quick-start` 和 `workflow-editor` 是两种创作入口，共用一份 `WorkflowRun` 和一个 `workflow-controller`。
- `playtest` 是独立核验台，只读取已确认的 Character，并保存当前核验结论。
- 当前不建设 History 和 Asset Library。Playtest 不承担二者职责，也不使用二者名称。

`features/workflow-controller` 是流程推进的唯一入口。页面不能自行维护第二套步骤状态。审核、发布和下载应保持为不同动作；下载文件不等于发布角色。

## 4. 状态归属

- 项目与已确认角色来自实体 API。
- 生成中状态属于 `Generation`；传输可以由轮询切换到 SSE，调用页面不感知实现方式。
- 创作步骤、候选选择和恢复信息属于前端 `WorkflowRun`。
- Playtest 播放器状态属于页面会话；核验结论通过 `PlaytestInspectionApis` 保存。
- 自动质量检测结果是从帧计算出的证据，不写回 `Frame` 或伪装成后端结论。

## 5. 外部接口边界

页面和 Feature 不直接调用 `fetch`。通用 HTTP 行为放在 `shared/api`，项目、角色、生成、媒体和核验接口分别由对应 `entities/*/api.ts` 适配。后端尚未提供的能力必须明确报错，不得返回假成功、假 ID 或假生成结果。

## 6. 增量迁移

`main` 中仍有早期骨架占位，例如 `action-template`、`asset-library` 和独立的 `project-detail` 目录。它们不代表新的目标架构，将在后续小 PR 中逐项处理。本 PR 只冻结规则并增加自动门禁，不混入页面重构或业务实现。
