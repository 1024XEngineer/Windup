# 四向 / 八向立绘 sheet 接口契约

日期：2026-08-26

状态：后端已落地。发布完整性见 #756：源方向才进模型，west / NW / SW 只记镜像。

相关：前端 3×3 候选拼图见 [direction-sheet-candidate](./2026-08-25-direction-sheet-candidate.md)（那份**不新增后端接口**，只把已有逐方向图拼网格）。本文件是真正的 sheet 生成口，两者不要混用。

## 目标

在 `/generation` 上新增两个提交口，分别跑四向立绘和八向立绘。调度、查任务、SSE 沿用现有 generation 任务信封。执行器、计费次数、失败语义分开，不经过 `POST /generation/image-set`。

正式立绘仍走 `POST /generation/image`，但必须是**正视图**（面对镜头，方向 `south`），确认后写入 `Character.reference_image_url`。本接口把这张图当作南向格，再转出其余朝向。不是把东向侧视母版拿来跳过生成。

## 生产顺序

```
定妆：正视图（south，面对镜头）→ 确认母版 URL
        ↓
图生图出侧视 / 背视：east、north（八向再出 north_east、south_east）
        ↓
镜像格水平翻转后上传：west ← east（八向再 NW ← NE、SW ← SE）
        ↓
拼成一张 3×3 罗盘 sheet（四向只填十字，斜向留空）→ 上传
        ↓
返回：sheet_url + 各方向原图 URL
```

东向是侧视，必须从图生图出，不能复用正视母版。

## 和现有两个口像什么、不像什么

**信封一样。** 提交立刻返回 `GenerationTaskOut`；进度和终态走：

- `GET /generation/tasks/{task_id}?project_id=`
- `GET /generation/tasks/{task_id}/stream?project_id=`

`task_type` / `status` / `input_payload` / `result` / `error_message` / `queue_ahead` 字段不改。

**请求体接近 `/generation/image`，外加 `/generation/action` 那种角色绑定。** 只要这些：

| 字段 | 来自 | 本接口 |
|---|---|---|
| `project_id` | image / action | 要 |
| `character_id` | action | 要（母版从角色上取，不另传 URL） |
| `prompt` / `negative_prompt` | image | 要，可空 |
| `width` / `height` | image | 要，且必须等于项目 `sprite_width` / `sprite_height`（格子尺寸） |
| `num_images` | image | 要，表示 **sheet 候选张数**，不是每方向各出几张 |

**不要从 image 抄：** `reference_image_url`、`direction`。母版只认 `character.reference_image_url`；朝向集合由路径决定，调用方再传一个方向等于第二份真相源。

**不要从 action 抄：** `action_type`、`custom_prompt`、`loop`、`ground_contact`、`num_frames`、`video_model`、`outfit_id`、`stance`、`reference_image_urls`、`reference_video_url`。sheet 不是动画。

**`result` 不像 image，也不像 action。** 不是 `image_urls[]`，也不是 `frames[]`。见下方结果形状。

四向和八向 **HTTP 字段相同**，路径和 `task_type` 不同。差别在执行器，不在请求字段再分叉一套。

## 端点

```
POST /generation/four-view
POST /generation/eight-view
```

| | four-view | eight-view |
|---|---|---|
| `task_type` | `character_four_view` | `character_eight_view` |
| 项目规格 | `directional_movement == 2` | `directional_movement == 3` |
| 身份锚（复用、不生成） | `south` 正视 | `south` 正视 |
| 图生图源方向 | `east`, `north` | `east`, `north`, `north_east`, `south_east` |
| 镜像、翻转后上传 | `west ← east` | `west ← east`，`north_west ← north_east`，`south_west ← south_east` |
| 交付 | 1 张 3×3 sheet + 4 张原图 URL | 1 张 3×3 sheet + 8 张原图 URL |
| sheet 布局 | 3×3 罗盘，只填北/西/东/南，斜向与中心留空 | 3×3 罗盘，中心留空，八角都填 |

单向项目（`directional_movement == 1`）不要打这两个口：母版本身就是唯一朝向。规格对不上 → `400`。

`POST /generation/image-set` 不再作为产品路径扩能力；旧任务仍可查询/恢复。本接口 **没有** `retry-failed-directions`：sheet 是一张图，失败整单重提，不按格局部重试。

## 请求

两口共用同一请求模型（`extra=forbid`）：

```json
{
  "project_id": 12,
  "character_id": 34,
  "prompt": "",
  "negative_prompt": "",
  "width": 64,
  "height": 96,
  "num_images": 1
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `project_id` | int | `> 0`，属于当前用户 |
| `character_id` | int | `> 0`，属于该项目 |
| `prompt` | str | 默认 `""`。身份由母版图承载；这里只补站姿/透视等，不复述外貌 |
| `negative_prompt` | str | 默认 `""` |
| `width` | int | `64–2048`，必须等于 `project.sprite_width` |
| `height` | int | `64–2048`，必须等于 `project.sprite_height` |
| `num_images` | int | `1–4`，默认 **1**（sheet 比单张立绘贵，不沿用 image 的默认 3） |

入口在入队前拒绝：

- 角色没有非空 `reference_image_url` → `400`「请先选择并确认角色母版」
- 项目规格与路径不一致 → `400`「当前项目不是四向/八向」
- 宽高与项目精灵尺寸不一致 → `400`（与 `/generation/image` 同一句）

母版 URL **不写进请求体**。落库的 `input_payload.reference_image_url` 由服务端在提交时从角色拷入，执行器只读这一份。调用方另传一张图看起来会生效、实际必须忽略 —— 按本仓惯例直接不收这个字段。

## 提交响应

与 image / action 相同：`Response[GenerationTaskOut]`，`status=pending`，`result=null`。

`input_payload` 最小集（执行器 / 计费 / 前端恢复只读这些）：

```json
{
  "character_id": 34,
  "reference_image_url": "https://…/master.png",
  "prompt": "",
  "negative_prompt": "",
  "width": 64,
  "height": 96,
  "num_images": 1,
  "anchor_direction": "south"
}
```

`anchor_direction` 固定 `south`：已确认母版是正视图，对应南向格（面对镜头）。东向是侧视，本任务里要图生图，不复用母版。不让请求体改锚点。

## 完成时 `result`

`result.type` 与 `task_type` 相同。`num_images` 张候选；**每张候选 = 1 个 `sheet_url` + 全部方向的原图 URL**（四向 4 张，八向 8 张）。格子上都有已上传 URL，前端不用自己翻转。

管线见上方「生产顺序」。南向格的 `image_url` 等于已确认正视母版；其余格子是本任务新上传的 URL。

```json
{
  "type": "character_four_view",
  "sheets": [
    {
      "sheet_url": "https://…/four-view-0.png",
      "cells": [
        { "direction": "south", "image_url": "https://…/master.png", "source_direction": null, "mirror_x": false },
        { "direction": "east", "image_url": "https://…/east-0.png", "source_direction": null, "mirror_x": false },
        { "direction": "north", "image_url": "https://…/north-0.png", "source_direction": null, "mirror_x": false },
        { "direction": "west", "image_url": "https://…/west-0.png", "source_direction": "east", "mirror_x": true }
      ]
    }
  ],
  "quality": null
}
```

八向：`type` 为 `character_eight_view`；`cells` 长度为 8；`sheet_url` 与四向同一张 3×3 罗盘（中心空）；斜向四格也有图；`west` / `north_west` / `south_west` 同样是翻转后上传的 URL，并标 `mirror_x`。

格子规则：

- 每个**有朝向的**格子 `image_url` 都必须非空。缺一格 URL 不能 `completed`。空槽（中心，以及四向的四个对角）不出现在 `cells[]` 里，也不上传假图。
- 真实源方向：`mirror_x=false`，`source_direction=null`。`south` 的 `image_url` 必须等于提交时拷入的正视母版 URL，不另出一张「几乎一样的正视」。`east` / `north`（八向还有对角）是图生图新图。
- 镜像方向：`mirror_x=true`，`source_direction` 指向源方向；`image_url` 是把源图水平翻转后**重新上传**得到的 URL。不调模型、不计费。
- 同一候选内 `direction` 不重复；集合必须恰好是该路径要求的 4 或 8 个方向。
- `width`×`height` 是单格尺寸。sheet 画布四向八向都是 `3w × 3h`。请求体不收 sheet 宽高。

## sheet 拼装（四向 / 八向同一张罗盘）

上北下南、左西右东，与 [direction-sheet-candidate](./2026-08-25-direction-sheet-candidate.md) 的 3×3 确认卡同一套坐标。单格 `w×h`，缝宽 0，画布 `3w × 3h`。空槽保持透明，不贴占位图。west 等镜像格贴**已经翻转好的 PNG**，拼装时不再翻一次。

```
列0          列1          列2
行0  north_west    north     north_east
行1  west          （空）      east
行2  south_west    south     south_east
```

| 格 | 方向 | 左上角 |
|---|---|---|
| (1,0) | north | `(w, 0)` |
| (0,1) | west | `(0, h)` |
| (2,1) | east | `(2w, h)` |
| (1,2) | south | `(w, 2h)` |
| (2,0) | north_east | `(2w, 0)` |
| (0,0) | north_west | `(0, 0)` |
| (2,2) | south_east | `(2w, 2h)` |
| (0,2) | south_west | `(0, 2h)` |
| (1,1) | 空 | — |

四向只贴 north / west / east / south 四格。八向再贴四个对角。脚底已在各格 `w×h` 内对齐，拼装不再二次对齐。


`quality` 与 image 同口径：只记账，不参与前端回填，本层不据此判成败。没有读数时为 `null`。

失败：`status=failed`，`result=null`，`error_message` 给用户可读原因。不引入 `partial`：缺一格就是整张 sheet 不能用。

## 计费与调度

走 generation Stream、与 `character_image` 同一图像并发池（`recover_as` 指向各自的 `task_type`，不要 recover 成 `character_image` 否则 handler 会按单张立绘跑）。

积分：`generate_image_cost × 计划模型调用次数`。

计划次数 = `num_images × 本路径要新生成的源方向数`：

- 四向：每张候选 **2** 次（east、north；south 复用正视母版）
- 八向：每张候选 **4** 次（east、north、north_east、south_east）

镜像不计费。失败整单解冻；成功按实际上游调用结算，口径与现有 image 预付费相同（提交时冻、终态 capture/release）。

## 确认之后怎么接到动作

本接口 **不写** `character_data.templates`，和 `/generation/image` 不写 `reference_image_url` 同一立场：生成给出候选，用户选一张候选 sheet 后由角色更新接口回填。

选中第 `i` 张后：

1. 源方向格子（有独立生成图或母版）写入 `character_data.templates`，带 `image_url`
2. 镜像格子写入 `templates` 时**只记** `source_direction` + `mirror_x`，不要把翻转图写成独立母版（`CharacterTemplateSequence` 禁止镜像行存图）
3. 之后每个**源方向**的动作仍走 `POST /generation/action`；`reference_image_urls[0]` 用该格 `image_url`
4. 镜像方向不调动作模型，沿用 `sequences[].mirror_x`

生成结果里的翻转 URL 给预览和拼 sheet 用，不是 `templates[]` 的第二份母版。

sheet 是站立立绘，不是 walk 循环。切格只得到各朝向静帧。

## 查询 / SSE

沿用现有任务查询与 stream。终态事件的 `result` 形状即上一节。前端用 `task_type` 区分 `character_four_view` / `character_eight_view`，不要复用 `character_template` 的 `images[]` 映射。

## 明确不做（本契约）

- 不把四向八向收成一个带 `directional_movement` 的通口
- 不在请求里让调用方声明方向列表或镜像表
- 不在本口生成动作帧、不调 i2v
- 不从一张 sheet 里切出 walk / attack
- 不为 sheet 单独做「失败格重试」
- 不改 `/generation/action` 的字段。四向/八向项目的定妆应走 `/generation/image` 且 `direction=south`（正视）；单向横版仍用默认 east。
