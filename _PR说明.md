# Generation + SSE Adapter

Refs #78

Issue #78 已补 `mile3` 标签并关联 `milestone/4`。本变更只实现前端 Generation
实体适配器与 SSE 传输封装，不修改后端、页面、Controller、共享入口或构建产物。

## 变更范围

- 将创建、按项目查询和状态订阅统一收口到 `GenerationApis`。
- `createGenerationApis` 必须由宿主注入 `userId` 与 `transport`；模块不写死用户身份，
  也不直接持有 `fetch` 或 `EventSource`。
- 新增业务无关的 `shared/api/stream.ts`，封装命名 SSE 事件、取消、终态关闭、
  非法消息错误和断线通知。临时断线保留浏览器 EventSource 的协议级自动重连，
  不恢复 2 秒业务轮询。
- 查询与订阅要求调用方传入 WorkflowRun 已知的阶段期望；动作阶段还必须带上
  `actionType`，避免把其他动作的帧误接到当前任务。
- 角色母版由宿主通过 `resolveImageSize(projectId)` 提供项目画布尺寸；Generation 不直接
  依赖 Project，也不会回退到可能冲突的 1024 默认值。

## 三阶段合同

| 前端阶段             | 后端请求                  | 固定/可配置数量           | 结果映射                     |
| -------------------- | ------------------------- | ------------------------- | ---------------------------- |
| `character_template` | `POST /generation/image`  | 固定 `num_images: 4`      | 严格校验并映射 4 个候选      |
| `first_frame`        | `POST /generation/action` | 固定 `num_frames: 1`      | 严格校验并映射 1 帧动作首帧  |
| `complete_animation` | `POST /generation/action` | 当前固定 `num_frames: 16` | 按后端 `frames[].index` 排序 |

`CompleteAnimationGenerationInput` 当前没有 `frameCount` 字段，因此无法由调用输入表达
帧数。本次保守沿用后端合同默认值 16；后续若合同加入可配置字段，应改为透传输入并补充
边界校验，而不是继续保留常量。

## SSE 行为

- 端点：`/generation/tasks/{taskId}/stream?project_id=...`。
- 只监听 `task_update` 命名事件，事件 DTO 在 Generation 边界解析和校验。
- `completed`、`failed` 都视为终态；事件先交付调用方，再由传输层关闭连接。
- `onError` 必传，非法事件关闭连接时不能静默留下永远等待的工作流。
- 显式取消返回幂等函数，并移除监听器、清空错误处理器、关闭 EventSource。
- 非法 JSON、非法 DTO 或调用方事件处理异常会报告错误并关闭连接。
- 浏览器连接中断会报告 `SSE 连接中断`，连接保持给 EventSource 自动重连；没有定时
  GET、退避 GET 或其他业务轮询。

## DTO 校验

- 校验响应 envelope 的 `code/message/data`，业务错误不会被当作成功数据。
- 校验任务与事件的正整数 ID、项目归属、用户归属、任务类型和四个合法状态。
- 未知状态直接抛 `GenerationApiError`，绝不降级为 `pending`。
- 校验完成结果的判别字段、图片 URL、候选/首帧数量、动作类型、16 帧数量与连续索引、
  时长格式与状态/错误一致性；非完成任务携带结果同样视为非法合同。

## 测试覆盖

- 三阶段请求体映射与注入用户身份。
- 角色母版四候选、动作一首帧、完整动画帧排序。
- 未知状态与非法完成结果 DTO。
- SSE URL、`task_update` 映射、主动取消、终态关闭、事件解析错误和断线恢复语义。

## 验证结果

- `npx oxfmt --check` 定向检查本次 5 个 TypeScript 文件：通过。
- `npm run format:check` 全量检查：已执行，但被基线中 41 个本次所有权外文件阻断；
  未批量重写这些文件，以免覆盖其他工作者的修改。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：通过，4 个测试文件、12 个测试，其中本模块新增 10 个。
- `npm run build`：通过，Vite 8.1.5 共转换 88 个模块。

后端 `/generation/tasks/{taskId}/stream` 的实现与真实联调不在本前端-only 变更范围内；
本次测试通过注入 transport 验证前端合同，不把它表述为后端 SSE 已可用。
