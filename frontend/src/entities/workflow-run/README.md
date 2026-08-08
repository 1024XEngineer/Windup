# WorkflowRun

本目录只保存工作流核心数据和后端持久化接口，不实现页面推进逻辑。

## 已确认的模型

- 前后端统一使用 `WorkflowNode`。原先前端的 Step 与后端的 Node 是同一概念，已经合并。
- `WorkflowRun.nodes` 直接保存真实节点，不再使用 `root.steps` 或人为包装的根节点。
- 六类节点与 Workflow Editor 的六类卡片一一对应：角色设定、角色母版、动作首帧、资产生成方式、完整动画和审核。
- “提交中、生成中、选择中”仍是节点内部 phase，不再拆成 Step 或额外任务节点。
- 节点通过 `dependsOnNodeIds` 保存直接前置依赖，因此边会与节点一起落库，不再依赖数组顺序猜测连线。
- 每个 Action 使用 `action-first-frame -> action-generation-method -> action-full-frame -> review` 四节点链；多条链共同依赖
  `character-template`，角色母版通过后即可并行，不互相阻塞。
- 资产生成方式当前可选 `video-cropping` 与 `3d-to-2d`。3D 转 2D 后端接口未提供前只保存选择并明确阻止提交，不伪装成视频路线。
- Quick Start 与 Workflow Editor 是两种独立界面，但推进同一张节点图，核心数据不区分 `ai/manual driver`。
- 后端不提供 Revision 历史。重做时覆盖旧结果，并用 `nodeId + taskId` 防止旧请求串线。
- 已发布 Action 被删除后，对应四节点分支以 `deletedAt` 标记并继续留在图中，生成输入、任务引用和审核历史不会被擦除；角色母版及其他并行动作不受影响。

## 前后端边界

前端负责节点结构、依赖边、推进规则和状态变化；后端只把 `WorkflowRun.nodes` JSON 原样保存。
HTTP 接口严格对应 `POST /workflow-runs`、`GET/PATCH/DELETE /workflow-runs/{id}`。

当前后端没有列表、按 Character 查询或订阅接口，因此前端也不虚构这些方法。所有持久化调用
都是异步的。后端 CRUD service 尚未实现时，本模块只提供真实接口适配器，不宣称已经联通。

## 文件

- `constants.ts`：核心节点状态、类型和 phase。
- `index.ts`：WorkflowRun、WorkflowNode 与 API 类型。
- `api.ts`：后端 DTO 映射、节点图校验和 HTTP 适配。
- `api.test.ts`：直接节点映射、边校验、删除标记及并行 Action 数据测试。
