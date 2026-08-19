# 四向与八向完整生产链路设计

## 目标

让 Project 的 `single`、`four-way`、`eight-way` 方向规格真正贯穿角色母版、动作首帧、完整动画、审核、Character 资产、预览台和导出。一个逻辑动作仍只有一条 WorkflowRun 分支，方向是动作内部的子状态，不为每个方向复制工作流节点。

本设计以用户确认的镜像规则替换 Issue #222 中“每个方向必须独立生成”的旧约束：左右方向允许水平镜像，上下方向必须独立生成；八向中的左上、左下分别由右上、右下水平镜像。

## 方向规则

统一使用屏幕坐标方向标识：

- `east`：右
- `west`：左
- `north`：上
- `south`：下
- `north_east`：右上
- `north_west`：左上
- `south_east`：右下
- `south_west`：左下

各项目规格的真实生成方向与镜像方向如下：

| 项目规格 | 真实生成方向 | 镜像方向 |
| --- | --- | --- |
| `single` | `east` | `west <- east` |
| `four-way` | `east`, `north`, `south` | `west <- east` |
| `eight-way` | `east`, `north`, `south`, `north_east`, `south_east` | `west <- east`, `north_west <- north_east`, `south_west <- south_east` |

所有镜像均为水平镜像。`north` 与 `south` 没有镜像关系，也不能互相替代。

## 资产契约

### 源序列与派生序列

Character 中的方向序列需要同时表达真实帧和镜像关系，但不重复保存图片：

```ts
type ActionDirection =
  | 'east'
  | 'west'
  | 'north'
  | 'south'
  | 'north_east'
  | 'north_west'
  | 'south_east'
  | 'south_west'

interface SourceActionSequence {
  direction: ActionDirection
  sourceDirection: null
  mirrorX: false
  frameCount: number
  frames: Frame[]
}

interface MirroredActionSequence {
  direction: ActionDirection
  sourceDirection: ActionDirection
  mirrorX: true
  frameCount: number
  frames: []
}
```

后端 Pydantic 模型使用同一语义的蛇形字段。校验规则为：

- 同一动作不能出现重复方向或未知方向。
- 源序列必须包含连续帧，派生序列不能保存帧。
- 派生关系不能形成链或环，且只能使用上表允许的镜像对。
- Project 要求的每个逻辑方向都必须能解析到一个真实源序列。
- `frame_count`、尺寸、时长和审核状态按镜像对保持一致。

现有顶层 `frames` 继续作为旧资产兼容入口。在 `single` 项目中将其解释为 `east`，并派生 `west`；在四向或八向项目中不据此猜测缺失方向。

### 多方向角色母版

`character_data` 增加方向母版集合，使用与动作序列相同的源/派生关系。现有 `reference_image_url` 保留，作为旧资产和 `east` 主母版的兼容字段。动作某个源方向只能引用相同方向的已确认角色母版。

## 生成接口

不新增 HTTP 路由，继续复用：

- `POST /generation/image`
- `POST /generation/action`
- `GET /generation/tasks/{task_id}`
- `GET /generation/tasks/{task_id}/stream`

现有请求和结果增加可选 `direction` 字段。旧调用方不传时按 `east` 兼容；多方向调用必须显式传源方向，后端结果原样返回并校验一致。

每个真实源方向使用一条独立 GenerationTask：

- 图片任务每个方向生成 2 张候选。
- 四向角色母版或动作首帧共生成 6 张候选。
- 八向角色母版或动作首帧共生成 10 张候选。
- 完整动画只为 3 或 5 个真实源方向创建任务。
- 镜像方向不创建任务、不上传重复图片、不单独扣费。

用户点击“生成全部方向”时，前端 Controller 按缺失源方向调用现有接口。任务由现有后端 Dispatcher 排队执行，不在前端并发压满 Provider。每个任务独立保存和恢复，因此失败方向可以单独重试，成功方向不会重复生成。

## WorkflowRun

节点拓扑保持不变：角色母版节点和每个动作仍使用现有的一条节点链。方向状态保存在节点内部：

- 角色母版节点：各源方向的任务引用、两张候选和已选图片。
- 动作首帧节点：各源方向的任务引用、两张候选和已选首帧。
- 完整动画节点：各源方向的任务引用和完成状态。
- 审核节点：按源方向分组审核，并同时展示其镜像结果。

`WorkflowGenerationRef` 增加可选 `direction`。旧引用没有方向时按 `east` 解释。节点只有在项目要求的全部源方向完成后才进入下一阶段；完整动画只有在所有镜像组审核通过后才允许发布。

页面刷新后，Controller 根据节点中的任务引用恢复每个方向。某方向失败时保留其他方向的候选、选择和结果；重新生成只清理该源方向及其镜像审核状态。

## Quick Start 与 Workflow Editor

两套界面继续共用同一 Run Session 和 Controller：

- Quick Start 自动按项目规格处理 1、3 或 5 个源方向，显示总体进度和当前方向。
- Workflow Editor 在现有节点内部增加方向标签，不复制节点。
- 每个源方向展示 2 张候选，镜像方向展示实时镜像预览并标明来源。
- 用户可以单独重做失败或不满意的源方向。
- 镜像组审核同时展示源方向与派生方向；拒绝任一侧都会退回对应源方向。

## 预览台

预览台从输入向量解析逻辑方向：

- 四向项目不进入斜向；同时按两个轴时按四向项目既定规则选择方向。
- 八向项目允许组合键产生四个斜向。
- 对角移动乘以 `sqrt(1/2)`，保证速度不快于单轴移动。
- 播放器先解析逻辑方向对应的源序列，再根据 `mirrorX` 决定是否水平翻转。
- 非移动动作保持位置不变，但仍按最后朝向播放对应方向。
- 四向和八向缺少必要源方向时明确报错，不借用邻近方向。

## 角色详情与发布

角色详情按逻辑方向展示源序列和镜像预览，明确标识缺失、生成中、待审核和已通过。发布校验读取 Character 所属 Project 的方向规格；缺少任一源方向、镜像关系非法或审核未通过时，动作不能标记为完整。

## 导出

导出模型和 `meta.json` 必须包含明确的 `direction`，不能再只通过文件名暗示方向。

源方向直接使用原始 PNG。镜像方向在导出阶段通过 Canvas 水平翻转，生成独立的逐帧 PNG 和 Sprite Sheet；最终导出包包含完整 2、4 或 8 个方向，但 Character 与对象存储仍只保存真实源帧。导出前校验：

- 项目要求的方向全部可解析。
- 所有源方向均已审核通过。
- 镜像关系合法且源方向存在。
- 各方向帧数、尺寸、索引和播放节奏一致。
- 元数据、逐帧目录和图集使用同一方向标识。

## 失败与恢复

- 单个方向任务失败不会把其他方向改成失败或删除其结果。
- 提交任务成功但 WorkflowRun 附加失败时，沿用现有未附加任务恢复机制。
- SSE 不可用时继续使用现有任务轮询兜底。
- 页面关闭或进程重启后，任务恢复仍由现有任务记录和 Dispatcher 恢复机制负责。
- 镜像方向没有独立任务；它的状态始终由源方向和镜像规则派生。

## 实施拆分

为控制评审规模，按以下顺序提交：

1. 方向契约与 PR368：将 `side/front/back` 收敛为完整八向标识，补源/派生序列、Character 往返和预览台八向解析。
2. 方向生成：复用现有生成接口，增加 `direction` 字段、每方向两张候选和独立任务结果。
3. 工作流：为现有节点增加方向子状态，接入 Quick Start、Workflow Editor、局部重做和恢复。
4. 发布与消费：补齐逐方向审核、角色详情、发布门禁和完整方向导出。
5. 真实验收：分别生成四向和八向角色的 idle、walk，完成审核、Playtest 和导出。

后续 PR 可以依赖前序 PR，但每个 PR 必须保持可测试、可回滚，不把全部改动压成一个数千行提交。

## 验收标准

- 四向真实生成 `east/north/south`，`west` 正确镜像。
- 八向真实生成五个源方向，三个左侧方向正确镜像。
- 每个源方向只提供两张候选，并能单独选择和重做。
- 上下方向永远使用独立任务与独立资产。
- 刷新和失败重试不会重复生成已完成方向。
- Quick Start 与 Workflow Editor 对同一 WorkflowRun 显示一致状态。
- Character 可以无损保存和读取源序列及镜像关系。
- Playtest 的四向、八向移动、朝向和斜向速度正确。
- 导出包包含完整方向的 PNG、图集和方向元数据。
- 旧单序列角色仍可查看、试玩和导出。
