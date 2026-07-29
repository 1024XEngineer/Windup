# 后端模块拆分

> 当前阶段：各模块定义抽象接口（ABC）+ Pydantic 领域模型。部分模块已有具体实现（media、project）。
> 每个模块包含 `interface.py`（接口）、`model.py`（领域模型），有实现的模块额外包含 `service.py`。

## 项目层级

```
backend/
├── packages/
│   ├── common/        # 共享：Response、BizException、BizCode 枚举
│   ├── framework/     # 基础设施：KodoStorage、ChatProvider、DB 配置
│   └── app/           # 业务应用
│       └── src/windup_app/
│           ├── web/api/          # FastAPI 路由
│           └── server/           # 领域抽象 + 实现
│               ├── user/             # 用户认证
│               ├── project/          # 项目管理
│               ├── character/        # 角色资产（隶属于项目）
│               ├── generation/       # AI 生成任务
│               ├── media/            # 文件上传（对象存储）
│               ├── quota/            # 待实现
│               ├── workflow/         # 待实现
│               └── ...               # 其他待实现
```

> **已删除的模块：** `asset`（角色本身就是资产，不另建 Asset 表）、
> `character/action`、`character/character_template`、`character/wearable`
> （造型/动作/帧存入 `character_data` JSONB，不另建子包和独立表）。

---

## 1. user — 用户认证

**对应表：** `windup_user` / `windup_user_oauth`  **接口：** `UserService`

| 方法 | 说明 |
|---|---|
| `register_by_email(input)` | 邮箱+密码注册，注册即登录 |
| `login_by_password(input)` | 邮箱+密码登录 |
| `send_verification_code(email)` | 发送邮箱验证码 |
| `login_by_code(input)` | 验证码登录，无账号自动注册 |
| `logout(session_token)` | 销毁会话 |
| `validate_session(token)` | 校验会话，返回 `User` 或 `None` |
| `refresh_session(token)` | 刷新会话 |
| `change_password(user_id, input)` | 修改密码（验证旧密码） |
| `get_by_id(id)` / `get_by_email(email)` | 按 ID/邮箱查用户 |

> **暂不设计/实现：** OAuth 第三方认证（`get_oauth_authorize_url` / `login_by_oauth` /
> `bind_oauth` / `get_oauth_bindings`）及相关模型 `OAuthCallbackInput` / `UserOAuth`
> 均已注解掉，保留注释占位作为后续扩展点。

---

## 2. project — 项目管理

**对应表：** `windup_project`  **接口：** `ProjectService`

| 方法 | 说明 |
|---|---|
| `create_project(project)` | 创建项目 |
| `project_name_exists(user_id, name)` | 名称唯一性校验 |
| `get_project(id)` | 按 ID 查询 |
| `list_projects(page, page_size, user_id)` | 分页查询 |
| `delete_project(id)` | 删除 |

---

## 3. character — 角色资产

**对应表：** `windup_character`  **接口：** `CharacterService`

角色是隶属于项目的资产。不再建立独立的 `Asset` 表、`CharacterTemplate` 表、
`Outfit` 表或 `Action` 表。造型、动作、动作帧等完整数据统一存储在
`character_data` JSONB 字段中。

**ORM 模型：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | BigInteger | 主键自增 |
| `project_id` | BigInteger | 所属项目 ID |
| `description` | Text | 角色描述 |
| `reference_image_url` | Text | 角色参考图（即旧概念中的 Character Template） |
| `character_data` | JSONB | 造型→动作→帧 完整嵌套数据 |
| `status` | SmallInteger | 1 正常 / 0 禁用 |
| `create_at` | DateTime(tz) | 创建时间 |
| `update_at` | DateTime(tz) | 更新时间 |

**`character_data` Pydantic 模型层级：**

```
CharacterData
└── outfits: list[CharacterOutfit]
    ├── id: str          # 造型稳定 ID
    ├── name: str        # 造型名称
    ├── description: str | None
    ├── preview_url: str | None
    └── actions: list[CharacterAction]
        ├── id: str          # 动作稳定 ID
        ├── type: str        # idle / walk / attack / custom
        ├── name: str        # 动作显示名称
        ├── loop: bool       # 是否循环播放
        ├── fps: float       # 播放帧率
        ├── frame_count: int # 帧数
        └── frames: list[CharacterFrame]
            ├── index: int
            ├── image_url: str
            └── duration_ms: int | None
```

**接口方法：**

| 方法 | 说明 |
|---|---|
| `create_character(session, **fields)` | 创建角色 |
| `get_character(session, character_id)` | 按 ID 查询 |
| `list_characters(session, *, project_id, page, page_size)` | 分页查询项目下的角色 |
| `update_character(session, character_id, **fields)` | 更新角色字段或 character_data |
| `delete_character(session, character_id)` | 删除角色 |

> **与旧设计的差异：** 不再有 `name` 字段（角色无需名称）、不再有子领域包
> （action / character_template / wearable）、不再有 `get_character_detail`
> 聚合方法。前端在 Workflow 中编辑 character_data，确认导出时一次性写回数据库。

---

## 4. generation — AI 生成任务

**接口：** `GenerationService`  **传输：** SSE 推送任务状态

职责：管理生成任务生命周期，按任务类型区分入参和出参。前端通过 SSE 订阅任务
状态变更，无需轮询。

**任务类型与出参对应关系：**

| 任务类型 | 入参 | 出参 | 前端回填目标 |
|---|---|---|---|
| `CHARACTER_IMAGE` | `CharacterImageInput` | `CharacterImageOutput` | `Character.reference_image_url` |
| `CHARACTER_ACTION` | `CharacterActionInput` | `CharacterActionOutput` | `character_data.outfits[].actions[].frames[]` |

**入参模型：**

- `CharacterImageInput`：`reference_image_url`、`prompt`、`negative_prompt`、`width`、`height`、`num_images`
- `CharacterActionInput`：`character_id`、`action_type`、`custom_prompt`、`reference_video_url`、`reference_image_urls`、`num_frames`

**出参模型：**

- `CharacterImageOutput`：`image_url`（前端写入 `Character.reference_image_url`）
- `CharacterActionOutput`：`action_type` + `frames[]`（前端写入 `character_data.outfits[].actions[].frames[]`）
  - `CharacterActionFrame`：`index`、`image_url`、`duration_ms`

**接口方法：**

| 方法 | 说明 |
|---|---|
| `generate_character_image(input)` | 提交角色图片生成任务 |
| `generate_character_action(input)` | 提交角色动作生成任务 |
| `get_task(project_id, task_id)` | 查询任务状态与结果 |

**SSE 调用流程：**

1. 前端 POST 提交任务，拿到 `task_id`。
2. 前端连接 `GET /generation/tasks/{task_id}/stream`，服务端在任务状态变化时
   推送 `task_update` 事件。事件 payload 包含 `task_id` / `task_type` / `status`，
   完成时附带 `result`，失败时附带 `error_message`。
3. 前端从 `status` 判断完成，从 `result` 取出对应类型的出参，回填 character 模块。

> **与旧设计的差异：** 不再使用策略模式（`GenerationStrategy` / `register_strategy` /
> `submit(payload)`），改为按任务类型拆分明确的接口方法。不再使用泛化出参
> `GenerationResult(urls, metadata)`，改为按任务类型细化出参
> `CharacterImageOutput` / `CharacterActionOutput`。不再使用前端轮询，改为 SSE 推送。

---

## 5. media — 文件上传

**接口：** `MediaService`  **实现：** `ObjectStorageMediaService`（使用 KodoStorage）

职责：接收前端上传的文件 → 写入对象存储 → 返回公开 URL。前端拿到 URL 后
回填 character 模块的相关字段（`reference_image_url` / `preview_url` /
`frames[].image_url`）。

**文件分类 `MediaCategory`：**

| 枚举值 | 用途 |
|---|---|
| `REFERENCE_IMAGE` | 角色参考图 → `Character.reference_image_url` |
| `OUTFIT_PREVIEW` | 造型预览图 → `CharacterOutfit.preview_url` |
| `ACTION_FRAME` | 动作帧 → `CharacterFrame.image_url` |
| `GENERAL` | 通用文件 |

**模型：**

- `MediaUploadInput`：`filename` / `content_type` / `size` / `category`
- `MediaUploadResult`：`url` / `object_key` / `filename` / `content_type` / `size`

**接口方法：**

| 方法 | 说明 |
|---|---|
| `upload(data, metadata)` | 上传文件到对象存储，返回 `MediaUploadResult` |

对象 key 格式：`media/{category}/{uuid}.{ext}`，不暴露用户原始文件名。

**API 端点：**

```
POST /media/upload?category=reference-image
Content-Type: multipart/form-data（字段名 file）
```

响应：`Response[MediaUploadResult]`，前端从 `data.url` 取值回填业务字段。

> **与旧设计的差异：** 不再使用策略模式（`MediaProcessor` / `register_processor` /
> `process(options)`）。当前阶段仅实现上传能力，缩略图/转码/元数据提取后续按需添加。
> media 模块不与角色表耦合，同一上传服务可处理参考图、造型预览图和动作帧。

---

## 待实现模块

| 包 | 预计职责 |
|---|---|
| `execution` | 任务执行引擎（消费队列、调用 AI、回调） |
| `export` | 导出（GIF、序列帧、精灵图集、游戏引擎格式） |
| `playtest` | 预览与试玩 |
| `quota` | 积分套餐与配额管理 |
| `review` | 生成候选质检与人工审核 |
| `workflow` | 节点工作流编排 |
