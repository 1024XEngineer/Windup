# 前后端接口对齐清单

本实现以尚未合并的后端 PR #75 为目标契约，并要求按 **#75 → 本前端 PR** 的顺序合并。`upstream/main` 当前尚未挂载这些接口。

## 一、本轮已接入

### Project

| 前端方法 | HTTP | 后端能力 |
|---|---|---|
| `ProjectApis.list` | `GET /projects` | `page`、`page_size`、可选 `user_id` |
| `ProjectApis.get` | `GET /projects/{id}` | 项目详情 |
| `ProjectApis.create` | `POST /projects` | 创建项目记录 |
| `ProjectApis.remove` | `DELETE /projects/{id}` | 删除项目记录 |

`ProjectOut` 的 `user_id`、`workflow_id`、`project_name`、`character_perspective`、`directional_movement`、精灵宽高、画风、参考图和时间字段，均在 `entities/project` 内显式映射为 camelCase。PR #75 没有项目更新端点，因此前端不声明 `ProjectApis.update`。

后端枚举按下表映射：

| 后端值 | `character_perspective` | `directional_movement` |
|---|---|---|
| `1` | `side` | `single` |
| `2` | `top-down` | `four-way` |
| `3` | `isometric` | `eight-way` |

### Character 资产树

| 前端方法 | HTTP | 后端能力 |
|---|---|---|
| `CharacterApis.listByProject` | `GET /characters?project_id=...` | 项目内角色分页列表 |
| `CharacterApis.get` | `GET /characters/{id}` | 角色详情 |
| `CharacterApis.create` | `POST /characters` | 创建空角色记录 |
| `CharacterApis.update` | `PATCH /characters/{id}` | 更新角色及完整资产树 |
| `CharacterApis.remove` | `DELETE /characters/{id}` | 删除角色及其媒体对象 |

后端持久化层级为：

```text
Character
└── character_data
    └── outfits[]
        └── actions[]
            └── frames[]
```

前端只映射后端真实字段：

- Character：`id`、`project_id`、`name`、`description`、`reference_image_url`、`character_data.version`、`status`
- Outfit：`id`、`name`、`description`、`preview_url`、`actions`
- Action：`id`、`type`、`name`、`loop`、`fps`、`frame_count`、`frames`
- Frame：`index`、`image_url`、`duration_ms`

Outfit、Action、Frame 没有独立端点。`outfit.characterId` 与 `action.outfitId` 仅由嵌套关系推导；修改任一子项时通过 `PATCH Character` 提交完整 `character_data`。

## 二、本轮明确不实现

- 新建项目流程：只保留禁用入口，后续单独实现。
- Workflow Editor 与生成流程：不在 Projects / 资产库模块内创建弹窗或复制生成逻辑。
- Action Template：后端没有模块、存储或 HTTP 接口，只保留带原因的禁用入口。
- 导出：PR #75 没有导出接口；PR #97 是尚未接入资产页的前端打包实现，只保留带原因的禁用入口。
- 穿戴资产：当前产品定义不向用户暴露独立 Wearable 层级。
- GIF：Character 契约只提供 Frame 图片 URL；动作卡预览使用排序后的第一帧，不伪造 GIF 字段。

## 三、仍需后端处理

这些问题不由前端降级或伪造数据规避：

1. PR #75 的 `POST /characters` DTO 接收 `name`，但路由没有把 `body.name` 传给 service；前端仍按已声明契约发送 `name`。
2. Project / Character 路由通过 JWT，但资源查询没有按 `request.state.current_user` 强制归属隔离；前端不能代替后端完成权限边界。
3. Project 删除没有级联 Character，可能留下孤立角色；数据一致性由后端修复。

## 四、运行前置

- 配置 `VITE_API_BASE_URL`。
- PR #75 的 Project / Character 路由要求 Bearer access token。Project、Character 实例已统一使用 `getApiAccessToken`；后续登录模块通过 `registerApiAccessTokenProvider` 提供实际 token。token 的取得、保存与刷新不属于本轮，接入前不能把未鉴权请求视为端到端可用。
- 本模块的生产代码不包含 Mock API 或 livedemo 资产。测试只在 Vitest 中用 HTTP 服务替身验证请求、响应映射与页面行为。
