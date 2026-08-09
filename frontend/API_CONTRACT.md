# 前后端接口对齐清单

更新于 2026-08-09。结论来自 `main` 以及仓库全部 PR 的文件范围核查；接口形状重点复核了后端 #126、#133、#150、#151、#152、#149、#172。关闭且未合并的 PR 只能作为历史参考，不能视为当前后端已经可用。

## 一、当前可用性

| 能力 | 后端现状 | 前端现状 |
|---|---|---|
| 用户认证与资料 | #149 已合并到 `main`，注册、登录、刷新、退出、当前用户、修改资料等路由可用 | 已接入；本地开发仍可显式选择本地登录 |
| 媒体上传 | `main` 已有 `POST /media/upload` | 已接入，按媒体类别上传并返回 URL |
| 项目 CRUD | `main` 没有项目路由；#150 有创建、列表、详情、删除实现，但仍未合并且存在冲突 | `ProjectApis` 已准备好对应适配器 |
| 角色 CRUD | `main` 没有角色路由；#150 有创建、列表、详情、整树更新、删除实现，但仍未合并且存在冲突 | `CharacterApis` 已准备好对应适配器 |
| 生成任务创建/查询 | `main` 声明了图片、动作、任务查询路由，但三个处理函数仍返回“接口待实现”；#151 有实现但未合并且存在冲突 | `GenerationApis.create/get` 已对齐 #151 请求与结果形状 |
| 生成任务 SSE | `main` 有 `/generation/tasks/{task_id}/stream`；#133 曾提供完整实现但已关闭，且当前 `main` 的任务创建/查询仍不可用 | 使用可鉴权 SSE，流路由 404 时退回查询；事件 `id/task_id` 统一转换为 `taskId` |
| WorkflowRun 存取 | `main` 和 #150 都只声明创建、详情、更新、删除，四个处理函数均为 `NotImplementedError` | HTTP Store 已准备好，不在页面复制存取逻辑 |
| WorkflowRun 列表/按角色查找 | 所有 PR 均未提供 | Store 保留 `list/getByCharacter` 契约，等待后端补路由；不伪造成功结果 |
| Playtest 核验记录 | 只有已关闭的 #126 提供过查询和保存；`main` 没有 | 前端适配器和页面已准备好，真实部署前等待后端恢复接口 |
| 3D 转 2D | #152 只有现有视频生成路线；#172 明确未实现的路线不进入枚举 | 六节点流程保留生成方式选择；选择 3D 转 2D 时明确提示尚未提供，不假装成功 |
| AI Agent 对话 | `POST /ai/chat` 仍是占位逻辑 | 不接入，避免把占位响应当成可用 Quick Start Agent |

## 二、WorkflowRun 责任边界

- Quick Start 与 Workflow Editor 共用同一份 `WorkflowRun`、六类 `WorkflowNode` 和 `WorkflowController`。
- 节点推进、边判断、中断和重做规则在前端；后端只存取完整节点图快照，不决定“下一个节点”。
- 节点间的边保存在 `dependsOnNodeIds`，不存在 `WorkflowRun -> root node -> steps` 的旧套层。
- 一个 Character 对应一个 WorkflowRun；新增 Action 在原运行中追加动作分支。

前端已经为并发保存准备以下契约：

```text
PATCH /workflow-runs/{id}
body.expected_version = 前端最后读取到的 version

成功：返回递增后的 version
冲突：HTTP 409，前端抛 WorkflowRunConflictError
```

后端仍需在数据库的一次原子更新中校验并递增版本。只有响应里放一个 `version` 字段、却不校验 `expected_version`，仍然会发生后保存覆盖先保存。

## 三、六节点与生成接口

| 前端节点 | 后端调用 | 说明 |
|---|---|---|
| `character-setup` | 项目/角色创建与可选媒体上传 | 只收集输入，不调用模型 |
| `character-template` | `POST /generation/image` | 默认请求 4 张母版候选 |
| `action-first-frame` | `POST /generation/action` | `num_frames=1`，母版作为参考图 |
| `action-generation-method` | 暂无独立后端调用 | 保存 `video-cropping` / `3d-to-2d` 选择；当前只有前者能继续 |
| `action-full-frame` | `POST /generation/action` | `num_frames=32`，确认的动作首帧作为首要参考图 |
| `review` | 角色整树更新 | 审核通过后把完整动作写回 Character |

图片或动作生成只产生任务结果，不自动推进 WorkflowRun，也不自动发布角色资产。完整动作的 `frames[]` 必须按 `index` 排序并保留 `duration_ms`。

## 四、已对齐的 DTO 规则

- 项目和生成接口的用户身份由后端认证中间件取得；前端不再发送固定 `user_id`。
- 后端数值 ID 在前端边界统一转换为字符串，页面不处理数值/字符串差异。
- `Character.name` 已进入 #150 和 #172，前端保留可空名称。
- `jump` 已进入 #151 与 #172，前端动作枚举无需再等待补充。
- `Character.reference_image_url` 是用户输入参考图；`character_data.outfits[].preview_url` 映射为造型确认后的 `characterTemplateUrl`，两者不是同一字段。
- 角色更新仍按后端合同整棵替换 `character_data`；Outfit、Action、Frame 没有独立写接口。
- 角色列表是后端分页接口；资产库为过滤草稿，会完整读取项目角色后在前端过滤并分页。

## 五、后端仍缺少的数据落点

以下内容不能假装已经持久化：

- Character 的正式 `draft/published` 状态。当前前端暂以“至少有一个 Action 且包含真实帧”判断可展示资产。
- WorkflowRun 的列表或按 Character 查询端点。
- WorkflowRun 的 `expected_version` 原子并发校验。
- `Action.keyFrameIndex` 与 `Frame.rootMotion` 的最终资产字段。
- 多方向动作的存储形状。#151 只生成主方向，四向/八向只是项目约束，不能据此伪造多方向帧。
- 生成任务取消、项目更新、3D 转 2D、正式历史版本接口。

另有一个不能由前端修复的后端安全阻塞：#150 的 Character 和 WorkflowRun 处理函数没有像
Project/Generation 那样校验资源是否属于当前登录用户。即使路由实现完成，也必须先补所有权
校验，不能依赖前端隐藏 ID。

母版候选、基础参考帧和生成方式选择属于 WorkflowRun 过程数据，不要求进入最终 Character 资产；如果产品以后要求跨运行恢复，再由后端新增明确字段。

## 六、前端当前处理原则

- 后端有正式路由与 DTO：在 `entities/*/api.ts` 转换，页面不直接 `fetch`。
- 后端只有未合并 PR：前端可以准备同形契约，但文档必须标明运行时不可用。
- 后端完全没有：保留最小接口、显式未配置错误和页面状态，不写本地假成功，不发明假 ID。
- 开发 Mock 只能显式装配且不得进入生产回退路径。
