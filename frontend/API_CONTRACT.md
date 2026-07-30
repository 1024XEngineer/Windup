# 前后端接口对齐清单

前端各模块的 `XxxApis` 与后端 PR #64（head `10dd958`）逐条比对结果。

后端现有四个相关模块：`project`、`character`、`generation`、`media`。`asset` 与 `wearable` 已按 07-30 评审要求删除。

---

## 一、前端预期有、后端目前没有

**这几条需要后端明确做或不做；不做的前端删掉。**

| 前端接口 | 后端情况 |
|---|---|
| `WorkflowRunApis`（`get` / `create` / `save`） | 没有 workflow 模块 |
| `ActionTemplateApis.listAvailable` | 没有 action template 模块 |
| `PlaytestInspectionApis`（`getLatest` / `record`） | 没有对应模块 |
| `TaskApis.cancel` | `GenerationService` 没有取消接口 |
| 独立的 `task` 模块 | 后端 Task 不独立，是 `generation` 内的 `GenerationTask` |

---

## 二、形状不一致

### 生成步骤：后端一步，前端两步

| 后端 `GenerationType` | 前端 `GenerationType` |
|---|---|
| `character_image` | `character_template` |
| `character_action` | `first_frame` → `complete_animation` |

前端设计是先出动作首帧、用户确认后再生成完整动画。后端 `generate_character_action` 是一次到底。

**这不是命名差异，是交互差异。需要确认首帧确认这一步保不保。**

### 其他

| 项 | 后端 | 前端 |
|---|---|---|
| 角色列表 | `list_characters` 分页，返回 `(list, total)` | `listByProject` 无分页 |
| 更新角色 | `update_character(character_id, **fields)` 部分更新 | `update(character)` 整棵树替换 |
| 查任务 | `get_task(project_id, task_id)` 需要 `project_id` | `get(taskId)` 只传 taskId |
| 动作类型 | `walk` `idle` `attack` `custom` | 多一个 `jump` |
| 删除项目 | 返回 `bool`（是否找到） | 返回 `void` |

ID 类型后端为 `int`、前端为 `string`，由前端转换层处理，不需要后端改动。

---

## 三、后端有、前端没接

| 后端 | 说明 |
|---|---|
| `project_name_exists(user_id, project_name)` | 建项目时的重名校验，前端未接 |
| `delete_character` | 前端 `CharacterApis` 没有删除 |
| `Character.description` | 后端存在实体上；前端只在创建入参里，创建完查不到 |
| `Character.reference_image_url` | 后端存在实体上；前端 `Character` 类型没有这个字段 |
| `MediaService.upload` | 前端本次未提交上传模块 |

---

## 四、审核数据无处保存

后端 `character_data` 的嵌套结构（见 `character/model.py`）：

```text
outfits[] → id / name / preview_url / actions[]
actions[] → id / type / name / loop / fps / frame_count / frames[]
frames[]  → index / image_url / duration_ms
```

前端以下字段在后端结构里没有落点：

- `Frame.qc`（系统质检结论）
- `Frame.rejected`（人工打回）
- `Action.kind`（preset / custom 来源）
- `Action.status`（planned / generating / candidate / confirmed / failed）
- `Action.keyFrameIndex`
- `Frame.rootMotion`
- `Outfit.candidateCharacterTemplates`（母版候选列表）
- `Outfit.baseFrames`

**其中 `qc` 与 `rejected` 是审核台的全部依据。后端不存这两个字段，审核结果就落不了库。**

`candidateCharacterTemplates` 同理：前端设计是生成多张候选让用户选，后端 `CharacterImageInput.num_images` 默认 1，`character_data` 里也没有候选列表。

---

## 五、概念不一致

后端 `character/model.py` 字段说明：

> `reference_image_url`: 角色参考图，即旧概念中的 Character Template

前端把这两者当成不同的东西：

- 用户上传的参考图 —— 创建角色时的输入
- AI 生成后用户选定的角色图（母版）—— `Outfit.characterTemplateUrl`

**后端合成了一个字段。** 07-30 评审也提到「模板」这个叫法容易与 action template 混淆，暂改称「角色图」。三方对这里是几个概念的理解需要统一。

---

## 待确认

- [ ] 第一节五条：后端做还是不做
- [ ] 动作生成一步还是两步
- [ ] `Frame.qc` / `Frame.rejected` 落不落库
- [ ] 母版候选几张
- [ ] 参考图与角色图是一个字段还是两个
- [ ] `Character.description` 前端要不要跟着存
- [ ] `jump` 动作类型后端加不加
- [ ] 上传模块何时提交
