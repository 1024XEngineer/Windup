# Frontend Modules

目录层级不等于业务模块。本项目按下面六个职责模块协作，每个模块可以横跨 `pages`、`features` 和 `entities`。

## 1. Project Workspace

管理项目列表、创建、详情和项目级画布约束。入口位于 `pages/projects`、`pages/project-create`、`pages/project-detail`，领域与后端转换位于 `entities/project`。

## 2. Character Assets

管理已经发布的角色资产树和上传媒体。`pages/asset-library` 只展示 `Character -> Outfit -> Action -> Frame`；数据边界位于 `entities/character` 和 `entities/media`。它不是工作流历史。

## 3. Creation Workflow

Quick Start 隐藏步骤自动推进，Workflow Editor 显式展示步骤；两者必须共享 `features/workflow-controller` 与 `entities/workflow-run`，不能各自维护节点状态。

## 4. Generation Execution

`entities/generation` 统一表示异步生成任务，负责创建、查询和订阅。项目中不再存在重复的 `Task` 实体。Controller 负责把 Generation 结果写回正确的 WorkflowStep。

## 5. Review And Publishing

`features/review` 表达审核通过或回推，`features/publish` 表达把完成版本发布为角色资产。审核改变运行状态；发布改变资产可见性，两者不是下载。

## 6. Playtest And Delivery

`pages/playtest` 是只读预览与问题记录工作台。`features/export-package` 从预览模型生成 Sprite Sheet 和清单下载包；它不推进 WorkflowRun，也不替代 Publish。

## Supporting Layers

`app` 统一组装路由、API 和共享 Controller；`shared` 提供不含业务含义的 HTTP、分页及通用能力。依赖规则详见 `ARCHITECTURE_GUARDRAILS.md`。
