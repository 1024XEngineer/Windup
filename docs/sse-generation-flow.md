# SSE 生成全流程与接口

## 1. 当前实现状态

当前生成任务已经具备异步任务模型，但**尚未实现 SSE 接口**：

- 后端支持提交角色图、提交动作和查询任务快照。
- 后台线程执行 AI 生成、上传图片并更新任务状态。
- 前端 `GenerationApis.subscribe()` 每 2 秒调用一次查询接口，属于轮询。
- `GET /generation/tasks/{task_id}/stream` 目前不存在。

因此，下文将“当前已经可用的接口”和“需要实现的 SSE 接口”分开描述。

## 2. 生成制作全流程
-+-++++++++++++++++++++++++
```mermaid
sequenceDiagram
    participant UI as Quick Start / Workflow Editor
    participant API as Generation API
    participant DB as GenerationTask
    participant Worker as Generation Executor
    participant AI as AI Engine
    participant Storage as Object Storage
    participant SSE as SSE Stream
    participant Character as Character API
    participant Playtest as Playtest

    UI->>API: POST /generation/image 或 /generation/action
    API->>DB: 创建 PENDING 任务
    API-->>UI: 返回 task_id 和任务快照
    API->>Worker: 启动后台生成
    UI->>SSE: 连接任务 stream
    SSE-->>UI: 推送 PENDING 当前快照
    Worker->>DB: 状态改为 RUNNING
    SSE-->>UI: 推送 RUNNING
    Worker->>AI: 按项目视角、尺寸和画风生成
    AI-->>Worker: 返回角色图或动作帧
    Worker->>Storage: 上传生成图片
    Storage-->>Worker: 返回图片 URL
    Worker->>DB: 写入结果并标记 COMPLETED
    SSE-->>UI: 推送 COMPLETED 和 result
    UI->>UI: 回填当前制作步骤并等待用户确认
    UI->>Character: 用户确认后写入角色、造型和动作
    Playtest->>Character: 读取已确认 Character
```

失败路径：Worker 捕获异常，将任务改为 `FAILED` 并写入 `error_message`；SSE 推送失败事件后关闭连接。断开 SSE 只停止接收消息，不取消后台任务。

## 3. 当前已经实现的接口

Base URL：`http://127.0.0.1:8000`

### 3.1 提交角色图生成

`POST /generation/image`

```json
{
  "user_id": 1,
  "project_id": 37,
  "reference_image_url": null,
  "prompt": "侧视像素风守夜人",
  "negative_prompt": "",
  "width": 256,
  "height": 256,
  "num_images": 4
}
```

后端创建 `character_image` 任务。输入宽高必须与项目精灵尺寸一致。

### 3.2 提交动作生成

`POST /generation/action`

```json
{
  "user_id": 1,
  "project_id": 37,
  "character_id": 25,
  "action_type": "custom",
  "custom_prompt": "举起并挥动灯笼",
  "reference_video_url": null,
  "reference_image_urls": ["https://example.com/master.png"],
  "num_frames": 32
}
```

后端创建 `character_action` 任务。生成器读取项目视角、画风和精灵尺寸，逐帧上传后返回完整帧列表。

### 3.3 查询任务快照

`GET /generation/tasks/{task_id}?project_id={project_id}`

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 71,
    "user_id": 1,
    "project_id": 37,
    "task_type": "character_action",
    "status": "completed",
    "input_payload": {},
    "result": {
      "type": "character_action",
      "action_type": "custom",
      "frames": [
        {
          "index": 0,
          "image_url": "https://example.com/frame-0.png",
          "duration_ms": 125
        }
      ]
    },
    "error_message": null
  }
}
```

任务状态只有：`pending`、`running`、`completed`、`failed`。当前模型没有百分比 `progress` 字段。

## 4. 需要新增的 SSE 接口

### 4.1 订阅任务状态

`GET /generation/tasks/{task_id}/stream?project_id={project_id}`

响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

连接建立后，服务端必须立即推送任务当前快照，不能等待下一次状态变化。任务进入终态后推送最后一条消息并关闭连接。

### 4.2 任务事件

```text
event: task_update
id: 71:2
retry: 2000
data: {"task_id":71,"project_id":37,"task_type":"character_action","status":"running","result":null,"error_message":null}

```

完成事件：

```text
event: task_update
id: 71:3
data: {"task_id":71,"project_id":37,"task_type":"character_action","status":"completed","result":{"type":"character_action","action_type":"custom","frames":[]},"error_message":null}

```

失败事件：

```text
event: task_update
id: 71:3
data: {"task_id":71,"project_id":37,"task_type":"character_action","status":"failed","result":null,"error_message":"母版下载失败"}

```

事件字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | int | 生成任务 ID |
| `project_id` | int | 所属项目 ID |
| `task_type` | string | `character_image` 或 `character_action` |
| `status` | string | 四种任务状态之一 |
| `result` | object/null | 仅完成时存在 |
| `error_message` | string/null | 仅失败时存在 |

### 4.3 心跳事件

服务端每 15 秒发送一次心跳，避免代理关闭空闲连接：

```text
event: ping
data: {}

```

心跳不进入业务状态机，前端可以忽略。

## 5. 后端处理规则

1. 建立流之前校验 `project_id + task_id`，不存在返回业务码 404。
2. 建立连接后立即查询数据库并推送当前快照。
3. 只在状态或结果变化时推送 `task_update`，不重复发送同一快照。
4. `completed` 或 `failed` 推送后关闭连接。
5. 客户端断开时释放监听资源，但不停止 GenerationTask。
6. 客户端重连时不依赖内存中的旧连接，重新读取数据库最新状态。
7. MVP 不添加虚假的百分比进度；若以后需要逐帧进度，应先扩展任务模型和事件表。

当前后台任务使用线程执行。单进程 MVP 可以使用任务通知队列唤醒 SSE；多进程部署时需要 Redis Pub/Sub、数据库通知或持久事件表，不能只依赖进程内 `asyncio.Queue`。

## 6. 前端接入规则

`GenerationApis` 的业务接口保持不变：

```ts
interface GenerationApis {
  create(input: GenerationInput): Promise<Generation>
  get(projectId: string, taskId: string): Promise<Generation>
  subscribe(
    projectId: string,
    taskId: string,
    onEvent: (event: GenerationEvent) => void,
  ): () => void
}
```

只替换 `subscribe()` 的传输实现：

```ts
const source = new EventSource(
  `/generation/tasks/${taskId}/stream?project_id=${encodeURIComponent(projectId)}`,
)

source.addEventListener('task_update', (message) => {
  onEvent(JSON.parse(message.data))
})

return () => source.close()
```

Workflow Controller 继续消费统一的 `GenerationEvent`，不应知道底层使用 SSE 还是轮询。页面刷新后先调用 `get()` 读取任务最新快照；若仍是 `pending/running`，再恢复 SSE 订阅。

## 7. 模块责任边界

- `generation`：创建任务、执行生成、保存任务结果、推送 SSE。
- `workflow-controller`：把任务结果写入当前前端制作步骤。
- `character`：只在用户确认后保存最终角色和动作。
- `playtest`：只读取已确认 Character 进行预览和核验，不订阅生成任务。
- 当前不接历史记录，也不建设资产库流程。
