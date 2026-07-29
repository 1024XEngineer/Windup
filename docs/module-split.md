# 后端模块拆分

> 当前阶段：所有模块仅定义抽象接口（ABC），暂不提供具体实现。
> 每个模块包含 `interface.py`（接口）和 `model.py`（领域模型）。

## 项目层级

```
backend/
├── packages/
│   ├── common/        # 共享：Response、BizException、BizCode 枚举
│   ├── framework/     # 基础设施：KodoStorage、ChatProvider、DB 配置
│   └── app/           # 业务应用
│       └── src/windup_app/
│           ├── web/api/          # FastAPI 路由
│           └── server/           # 领域抽象
│               ├── user/             # 用户认证
│               ├── project/          # 项目管理
│               ├── asset/            # 资产库
│               ├── character/        # 角色
│               │   ├── action/       #   动作子领域
│               │   ├── character_template/  #   模板子领域
│               │   └── wearable/     #   穿戴子领域
│               ├── generation/       # AI 生成（策略模式）
│               ├── media/            # 媒体上传与加工（策略模式）
│               ├── execution/        # 待实现
│               ├── export/           # 待实现
│               ├── playtest/         # 待实现
│               ├── quota/            # 待实现
│               ├── review/           # 待实现
│               └── workflow/         # 待实现
```

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
| `get_oauth_authorize_url(provider, redirect_uri)` | 获取 GitHub/Google 授权页 |
| `login_by_oauth(input)` | OAuth 回调，自动注册/绑定/登录 |
| `bind_oauth(user_id, input)` | 已登录用户绑定第三方 |
| `validate_session(token)` | 校验会话，返回 `User` 或 `None` |
| `refresh_session(token)` | 刷新会话 |
| `change_password(user_id, input)` | 修改密码（验证旧密码） |
| `get_by_id(id)` / `get_by_email(email)` | 按 ID/邮箱查用户 |
| `get_oauth_bindings(user_id)` | 已绑定第三方列表 |

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

## 3. asset — 资产库

**对应表：** `windup_asset`  **接口：** `AssetService`

职责：项目级统一存储层。只关心"文件是什么"，不关心"谁在用"。

`AssetType`：`character_template` / `character_action` / `wearable`

| 方法 | 说明 |
|---|---|
| `create(input)` | 上传完成后创建资产记录 |
| `get(id)` | 按 ID 查询 |
| `list_by_project(project_id, filter, page, page_size)` | 按类型/关键词/状态筛选 |
| `update(id, input)` | 更新名称/描述/缩略图/元数据 |
| `delete(id)` | 删除资产及关联表引用 |
| `get_by_ids(ids)` | 批量查询 |
| `count_by_type(project_id)` | 各类型资产数量统计 |

---

## 4. character — 角色

**对应表：** `windup_character`  **接口：** `CharacterService`

角色是资产的组织单元，通过三张关联表挂载模板/动作/穿戴道具，子实体管理委托给各自子领域。

| 方法 | 说明 |
|---|---|
| `create_character(input)` | 创建角色 |
| `get_character(id)` | 按 ID 查询 |
| `list_characters(project_id, page, page_size)` | 分页查询（左侧列表） |
| `update_character(id, input)` | 更新名称/描述 |
| `delete_character(id)` | 删除角色及所有关联 |
| `get_character_detail(id)` | 聚合详情，一次性返回模板+动作+穿戴（右侧面板） |

### 子领域

| 子包 | 对应表 | 接口 | 方法 |
|---|---|---|---|
| `character/action/` | `windup_character_action` | `CharacterActionService` | `add_action` / `list_actions` / `remove` |
| `character/character_template/` | `windup_character_template` | `CharacterTemplateService` | `add_template` / `list_templates` / `set_current` / `remove` |
| `character/wearable/` | `windup_character_wearable` | `CharacterWearableService` | `equip` / `list_wearables` / `update_position` / `unequip` |

穿戴子领域额外支持挂载定位：`slot_type`(head/body/hand/back/weapon)、`position_x/y`、`scale`、`rotation`、`z_order`。

---

## 5. generation — AI 生成（策略模式）

职责：管理生成任务生命周期，按 `task_type` 分发到对应策略。

```
GenerationService（上下文）
    ├── CharacterImageStrategy   (角色立绘/头像)
    └── CharacterActionStrategy  (动作：walk/idle/attack/jump/custom)
```

**策略 `GenerationStrategy`：** `task_type` + `validate_input(payload)` + `generate(payload)`

**上下文 `GenerationService`：**

| 方法 | 说明 |
|---|---|
| `register_strategy(strategy)` | 注册生成策略 |
| `submit(user_id, task_type, payload, project_id)` | 提交任务 |
| `get_task(id)` | 查询任务状态+结果 |
| `list_tasks(user_id, ...)` | 分页查询 |
| `cancel(id)` | 取消未开始任务 |

---

## 6. media — 媒体上传与加工（策略模式）

职责：媒体资产 CRUD + 加工（缩略图/转码/元数据提取），按 `media_type` 分发。

```
MediaService（上下文）
    ├── ImageProcessor   (图片：缩略图、格式转换)
    ├── VideoProcessor   (视频：转码、GIF 预览)
    ├── AudioProcessor   (音频：转码、波形)
    └── Model3DProcessor (3D 模型：格式转换、渲染缩略图)
```

**策略 `MediaProcessor`：** `media_type` + `process(url, options)` + `thumbnail(url)` + `extract_metadata(url)`

**上下文 `MediaService`：**

| 方法 | 说明 |
|---|---|
| `register_processor(processor)` | 注册处理器 |
| `create(user_id, media_type, url, ...)` | 上传完成后创建媒体记录 |
| `get(id)` / `list(...)` / `delete(id)` | CRUD |
| `process(media_id, options)` | 按类型分发加工 |
| `generate_thumbnail(media_id)` | 生成缩略图 |
| `refresh_metadata(media_id)` | 重新提取元数据 |

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