# Windup API 接口文档

> **Base URL**: `http://127.0.0.1:8000`
> **Content-Type**: `application/json`（除文件上传外）
> **最后更新**: 2026-07-30

---

## 目录

1. [项目管理 (Projects)](#1-项目管理-projects)
2. [角色管理 (Characters)](#2-角色管理-characters)
3. [媒体上传 (Media)](#3-媒体上传-media)
4. [生成任务 (Generation)](#4-生成任务-generation)
5. [通用说明](#5-通用说明)

---

## 1. 项目管理 (Projects)

### 1.1 创建项目

**`POST /projects`**

| 参数 | 类型 | 必填 | 校验 | 说明                      |
|---|---|-|---|-------------------------|
| `user_id` | int | ✅ | `>0` | 用户 ID                   |
| `project_name` | string | ✅ | `1~20字符` | 项目名称（同用户下不可重复）          |
| `character_perspective` | int | ✅ | `1~3` | 角色视角（1=侧视, 2=正面, 3=正面）  |
| `directional_movement` | int | ✅ | `1~3` | 方向移动方式 （1=单向，2=四向，3=八向） |
| `sprite_width` | int | ✅ | `32~2048` | 精灵图宽度                   |
| `sprite_height` | int | ✅ | `32~2048` | 精灵图高度                   |
| `workflow_id` | int \| null | | — | 工作流 ID                  |
| `game_style` | string \| null | | — | 游戏风格                    |
| `sprite_sample_url` | string \| null | — | 精灵图示例 URL               |

**返回示例**：

```json
{
  "code": 200,
  "message": "创建成功",
  "data": {
    "id": 6,
    "user_id": 1,
    "project_name": "像素勇者",
    "character_perspective": 1,
    "directional_movement": 1,
    "sprite_width": 256,
    "sprite_height": 256,
    "workflow_id": null,
    "game_style": null,
    "sprite_sample_url": null,
    "create_at": "2026-07-30T10:00:00Z",
    "update_at": "2026-07-30T10:00:00Z"
  }
}
```

**错误**：项目名重复返回 `400`。

---

### 1.2 项目列表

**`GET /projects`**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|-|---|---|
| `user_id` | int \| null | null | 按用户筛选 |
| `page` | int  | 1 | 页码（≥1） |
| `page_size` | int  | 20 | 每页条数（1~100） |

**返回示例**：

```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "id": 6,
      "user_id": 1,
      "project_name": "像素勇者",
      "character_perspective": 1,
      "directional_movement": 1,
      "sprite_width": 256,
      "sprite_height": 256,
      "create_at": "2026-07-30T10:00:00Z",
      "update_at": "2026-07-30T10:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20
}
```

---

### 1.3 获取项目详情

**`GET /projects/{project_id}`**

| 参数 | 类型 | 位置 | 说明 |
|---|---|---|---|
| `project_id` | int | path | 项目 ID |

**返回**：单个 `ProjectOut` 对象（结构同列表项）。

---

### 1.4 删除项目

**`DELETE /projects/{project_id}`**

| 参数 | 类型 | 位置 | 说明 |
|---|---|---|---|
| `project_id` | int | path | 项目 ID |

**返回**：

```json
{
  "code": 200,
  "message": "删除成功",
  "data": null
}
```

---

## 2. 角色管理 (Characters)

### 2.1 创建角色

**`POST /characters`**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `project_id` | int | ✅ | 所属项目 ID |
| `description` | string \| null | ❌ | 角色描述 |
| `reference_image_url` | string \| null | ❌ | 角色参考图 URL |
| `character_data` | object | ❌ | 角色完整数据（见下方结构） |

**`character_data` 结构**：

```json
{
  "version": 1,
  "outfits": [
    {
      "id": "outfit_01",
      "name": "默认套装",
      "description": "初始装备",
      "preview_url": "http://...",
      "actions": [
        {
          "id": "walk_01",
          "type": "walk",
          "name": "走路",
          "loop": true,
          "fps": 12,
          "frame_count": 8,
          "frames": [
            {
              "index": 0,
              "image_url": "http://...",
              "duration_ms": 125
            }
          ]
        }
      ]
    }
  ]
}
```

**`character_data` 字段说明**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `version` | int | ❌ | 1 | 数据版本号 |
| `outfits` | list | ❌ | [] | 套装列表 |

**`outfits[]` 字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 套装唯一 ID |
| `name` | string | ✅ | 套装名称 |
| `description` | string \| null | ❌ | 套装描述 |
| `preview_url` | string \| null | ❌ | 套装预览图 URL |
| `actions` | list | ❌ | 动作列表 |

**`outfits[].actions[]` 字段说明**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `id` | string | ✅ | — | 动作唯一 ID |
| `type` | string | ✅ | — | 动作类型：`walk` / `idle` / `attack` / `custom` |
| `name` | string | ✅ | — | 动作名称 |
| `loop` | bool | ❌ | false | 是否循环播放 |
| `fps` | float | ❌ | 12 | 帧率（>0） |
| `frame_count` | int | ❌ | 0 | 帧数（≥0） |
| `frames` | list | ❌ | [] | 帧列表 |

**`actions[].frames[]` 字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `index` | int | ✅ | 帧序号（从0开始） |
| `image_url` | string | ✅ | 帧图片 URL |
| `duration_ms` | int \| null | ❌ | 单帧时长（毫秒） |

**返回示例**：

```json
{
  "code": 200,
  "message": "创建成功",
  "data": {
    "id": 1,
    "project_id": 6,
    "description": "武士角色",
    "reference_image_url": "http://...",
    "character_data": { "version": 1, "outfits": [] },
    "status": 1
  }
}
```

---

### 2.2 角色列表

**`GET /characters`**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `project_id` | int | ✅ | — | 所属项目 ID |
| `page` | int | ❌ | 1 | 页码 |
| `page_size` | int | ❌ | 20 | 每页条数（1~100） |

**返回**：`ListResponse[CharacterOut]`，结构同项目列表。

---

### 2.3 获取角色详情

**`GET /characters/{character_id}`**

| 参数 | 类型 | 位置 | 说明 |
|---|---|---|---|
| `character_id` | int | path | 角色 ID |

**返回**：单个 `CharacterOut` 对象。

---

### 2.4 更新角色

**`PATCH /characters/{character_id}`**

> 只传需要修改的字段即可，未传的字段不修改。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `description` | string \| null | ❌ | 角色描述 |
| `reference_image_url` | string \| null | ❌ | 参考图 URL |
| `character_data` | object \| null | ❌ | 完整角色数据（同创建） |

**返回**：更新后的 `CharacterOut`。

---

### 2.5 删除角色

**`DELETE /characters/{character_id}`**

| 参数 | 类型 | 位置 | 说明 |
|---|---|---|---|
| `character_id` | int | path | 角色 ID |

**返回**：

```json
{
  "code": 200,
  "message": "删除成功",
  "data": null
}
```

---

## 3. 媒体上传 (Media)

### 3.1 上传图片

**`POST /media/upload`**

> Content-Type: `multipart/form-data`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | File | ✅ | 图片文件（只接受 `image/*`） |
| `category` | string | ❌ | 分类：`reference-image` / `outfit-preview` / `action-frame` / `general`（默认 `general`） |

**返回示例**：

```json
{
  "code": 200,
  "message": "上传成功",
  "data": {
    "url": "http://tio55tpsq.hd-bkt.clouddn.com/media/reference-image/abc123.png",
    "object_key": "media/reference-image/abc123.png",
    "filename": "knight.png",
    "content_type": "image/png",
    "size": 16140
  }
}
```

**错误**：非图片文件返回 `400`。

---

## 4. 生成任务 (Generation)

> 生成任务均为**异步**：先创建任务记录返回 `id`，前端轮询 `GET /generation/tasks/{id}` 获取状态和结果。

### 4.1 提交图片生成任务

**`POST /generation/image`**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `user_id` | int | ✅ | — | 用户 ID |
| `project_id` | int \| null | ❌ | null | 项目 ID |
| `reference_image_url` | string \| null | ❌ | null | 参考图 URL（可选，纯文生图可不传） |
| `prompt` | string | ❌ | "" | 生成提示词 |
| `negative_prompt` | string | ❌ | "" | 反向提示词 |
| `width` | int | ❌ | 1024 | 输出宽度 |
| `height` | int | ❌ | 1024 | 输出高度 |
| `num_images` | int | ❌ | 1 | 生成数量 |

**返回示例**：

```json
{
  "code": 200,
  "message": "任务已提交",
  "data": {
    "id": 9,
    "user_id": 1,
    "project_id": 6,
    "task_type": "character_image",
    "status": "pending",
    "input_payload": {
      "reference_image_url": null,
      "prompt": "帮我生成一个穿着日本和服的女人",
      "negative_prompt": "",
      "width": 256,
      "height": 256,
      "num_images": 1
    },
    "result": {"image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/reference-image/9516edb3261e45c39362e0a49e184fe1.png"},
    "error_message": null
  }
}
```

---

### 4.2 提交动作生成任务

**`POST /generation/action`**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `user_id` | int | ✅ | — | 用户 ID |
| `project_id` | int \| null | ❌ | null | 项目 ID |
| `character_id` | int | ✅ | — | 角色 ID |
| `action_type` | string | ✅ | — | 动作类型：`walk` / `idle` / `attack` / `custom` |
| `custom_prompt` | string \| null | ❌ | null | 自定义提示词 |
| `reference_video_url` | string \| null | ❌ | null | 参考视频 URL |
| `reference_image_urls` | list[string] | ❌ | [] | 参考图 URL 列表（第一张作为母版） |
| `num_frames` | int | ❌ | 16 | 生成帧数 |

**返回示例**：

```json
{
  "code": 200,
  "message": "任务已提交",
  "data": {
    "id": 15,
    "user_id": 1,
    "project_id": 6,
    "task_type": "character_action",
    "status": "pending",
    "input_payload": {
      "character_id": 1,
      "action_type": "walk",
      "custom_prompt": null,
      "reference_image_urls": ["http://..."],
      "num_frames": 8
    },
    "result": {"frames": [{"index": 0, "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/35069fad379f4623be7e0bbdd389e6a9.png", "duration_ms": 125}, {"index": 1, "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/a25b81d26b7e42f49be05bbe2a2bf131.png", "duration_ms": 125}, {"index": 2, "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/b39b7ae9d7a34bf1b022d38f6e149851.png", "duration_ms": 125}, {"index": 3, "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/9e5305bd74124f908459a45dbc7163b5.png", "duration_ms": 125}, {"index": 4, "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/31331423ff974617a4f68c6e3dd93220.png", "duration_ms": 125}, {"index": 5, "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/48e682d778dd4cc9b7b579f355a4896f.png", "duration_ms": 125}, {"index": 6, "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/cdbb141f59ed40e8816cd68a25a82d30.png", "duration_ms": 125}, {"index": 7, "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/f322162bd25847819a153edd0074c938.png", "duration_ms": 125}], "action_type": "walk"},
    "error_message": null
  }
}
```

---

### 4.3 查询生成任务

**`GET /generation/tasks/{task_id}`**

| 参数 | 类型 | 位置 | 必填 | 说明 |
|---|---|---|---|---|
| `task_id` | int | path | ✅ | 任务 ID |
| `project_id` | int | query | ✅ | 项目 ID |

**状态流转**：`pending` → `running` → `completed` / `failed`

**completed 时的 result 结构**：

- **图片任务** (`character_image`)：

```json
{
  "result": {
    "type": "character_image",
    "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/reference-image/xxx.png"
  }
}
```

- **动作任务** (`character_action`)：

```json
{
  "result": {
    "type": "character_action",
    "action_type": "walk",
    "frames": [
      {
        "index": 0,
        "image_url": "http://tio55tpsq.hd-bkt.clouddn.com/media/action-frame/xxx.png",
        "duration_ms": 125
      },
      {
        "index": 1,
        "image_url": "http://...",
        "duration_ms": 125
      }
    ]
  }
}
```

**failed 时**：

```json
{
  "status": "failed",
  "error_message": "具体错误信息",
  "result": null
}
```

---

## 5. 通用说明

### 5.1 统一响应格式

**单条数据** `Response[T]`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | int | 业务状态码（200=成功） |
| `message` | string | 状态消息 |
| `data` | T \| null | 业务数据 |

**列表数据** `ListResponse[T]`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | int | 业务状态码 |
| `message` | string | 状态消息 |
| `data` | list[T] | 数据列表 |
| `total` | int | 总条数 |
| `page` | int | 当前页 |
| `page_size` | int | 每页条数 |

### 5.2 错误码

| HTTP 状态码 | 说明 |
|---|---|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |

### 5.3 枚举值

**动作类型 `action_type`**：`walk` / `idle` / `attack` / `custom`

**媒体分类 `category`**：`reference-image` / `outfit-preview` / `action-frame` / `general`

**任务状态 `status`**：`pending` → `running` → `completed` / `failed`

### 5.4 生成任务轮询建议

```javascript
// 前端轮询示例
async function pollTask(taskId, projectId) {
  while (true) {
    const res = await fetch(`/generation/tasks/${taskId}?project_id=${projectId}`);
    const { data } = await res.json();

    if (data.status === 'completed') return data.result;
    if (data.status === 'failed') throw new Error(data.error_message);

    await new Promise(r => setTimeout(r, 2000)); // 2秒轮询
  }
}
```
