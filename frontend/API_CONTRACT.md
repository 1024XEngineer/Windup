# 前后端接口对齐清单

前端各模块的 `XxxApis` 与后端 2026-07-30 接口文档逐条比对结果。

后端现有四个相关模块：`project`、`character`、`generation`、`media`。`asset` 与 `wearable` 已按 07-30 评审要求删除。

---

## 一、已经确认的边界

- `WorkflowRun` 是前端固定工作流的运行态。后端不读取、不推进、也不持久化，前端不声明 `WorkflowRunApis`。
- `Character` 不使用独立 `name` 字段；前端已删除。
- 前端保留 `jump` 动作类型，由后端补充对应枚举。
- 查询生成任务统一携带 `projectId + taskId`。
- 前端工作流节点不与后端 `GenerationType` 一一对应，按下表调用：

| 前端工作流节点 | 后端接口 | 后端任务类型 |
|---|---|---|
| `character_template` | `POST /generation/image` | `character_image` |
| `first_frame` | `POST /generation/image`，以上一步角色图作为参考图 | `character_image` |
| `complete_animation` | `POST /generation/action`，以已确认动作首帧作为参考图 | `character_action` |

图片生成和动作生成只返回任务及结果，不自动修改 WorkflowRun 或角色资产。用户最终确认后，前端再通过角色更新接口保存角色图和完整动作数据。

动作任务的 `frames[]` 会完整映射为 WorkflowRun 的 `complete_animation` 结果，保留顺序和
`duration_ms`。审核前为满足动作生成接口的 `character_id/outfit_id` 要求，前端会创建一条
尚无动作的角色草稿；只有审核通过后才把完整动作写回该角色。当前后端没有草稿/已发布状态，
因此资产库暂以“造型至少包含一个动作”作为已发布资产的显示条件。

---

## 二、前端不声明的后端缺失能力

后端目前没有项目更新和生成任务取消接口，前端相应地不声明 `ProjectApis.update` 或生成取消方法。创建、查询和轮询统一由 `GenerationApis` 提供。

---

## 三、形状不一致

这些差异可以在前端接口层转换，不要求领域类型与后端 DTO 使用相同命名。

| 项 | 后端 | 前端 |
|---|---|---|
| 角色列表 | `list_characters` 分页，返回 `(list, total)` | `listByProject` 无分页 |
| 更新角色 | `update_character(character_id, **fields)` 部分更新 | `update(character)` 整棵树替换 |
| 等待任务完成 | 提供 `GET /generation/tasks/{task_id}` 轮询 | `GenerationApis.subscribe`；适配器先立即回放当前快照，再继续轮询 |
| 图片生成数量 | 入参有 `num_images`，结果只有一个 `image_url` | 角色图候选结果是 `images[]` |
| 动作类型 | `walk` `idle` `attack` `custom`；待增加 `jump` | `walk` `idle` `attack` `jump` `custom` |
| 角色视角 | `character_perspective` 为 `1~3`，文档中 2、3 都写成“正面” | `side` `top-down` `isometric` |

ID 类型后端为 `int`、前端为 `string`，由前端转换层处理，不需要后端改动。

---

## 四、后端有、前端没接

| 后端 | 说明 |
|---|---|
| `delete_character` | 前端 `CharacterApis` 没有删除 |
| `Character.description` | 后端存在实体上；前端只在创建入参里，创建完查不到 |
| `Character.reference_image_url` | 后端存在实体上；前端 `Character` 类型没有这个字段 |

---

## 五、前端资产字段在后端没有落点

后端 `character_data` 的嵌套结构（见 `character/model.py`）：

```text
outfits[] → id / name / preview_url / actions[]
actions[] → id / type / name / loop / fps / frame_count / frames[]
frames[]  → index / image_url / duration_ms
```

前端以下字段在后端结构里没有落点：

- `Action.kind`（preset / custom 来源）
- `Action.keyFrameIndex`
- `Frame.rootMotion`
- `Outfit.candidateCharacterTemplates`（母版候选列表）
- `Outfit.characterTemplateUrl`（每套造型的已确认角色图）
- `Outfit.baseFrames`

`candidateCharacterTemplates` 属于生成过程数据；若只在当前 WorkflowRun 中使用，可以留在前端。其余字段若要随最终资产恢复，需要后端增加字段，或者前端在 MVP 中删除。

---

## 六、概念不一致

后端 `character/model.py` 字段说明：

> `reference_image_url`: 角色参考图，即旧概念中的 Character Template

前端把这两者当成不同的东西：

- 用户上传的参考图 —— 创建角色时的输入
- AI 生成后用户选定的角色图（母版）—— `Outfit.characterTemplateUrl`

**后端合成了一个字段。** 07-30 评审也提到「模板」这个叫法容易与 action template 混淆，暂改称「角色图」。三方对这里是几个概念的理解需要统一。

---

## 待确认

- [ ] 母版候选几张
- [ ] 参考图与角色图是一个字段还是两个
- [ ] `Character.description` 前端要不要跟着存
- [ ] `Action.kind` / `Action.keyFrameIndex` / `Frame.rootMotion` 是否进入最终资产

## 已分工

- [x] 前端删除 `WorkflowRunApis`，WorkflowRun 全程由前端管理
- [x] 前端删除 `Character.name`
- [ ] 后端增加 `jump` 动作类型
