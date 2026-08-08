# WorkflowRun

本目录保存前端工作流的核心模型和异步持久化契约。节点推进规则属于前端；后端只保存
`WorkflowRun` 的图快照，不判断“下一步该执行什么”。

## 当前图结构

新建角色的标准流程共有六个真实节点：

```text
角色设定 → 生成角色图 → 生成动作首帧 → 选择生成路线 → 生成完整动画 → 审核
```

- `action-generation-method` 当前可选择 `video-cropping`；`3d-to-2d` 只保留入口，等待后端接口。
- 每个节点通过 `dependsOnNodeIds` 保存直接前置节点，边不依赖数组位置推断。
- 角色母版通过后，每个新增 Action 都从母版节点分出自己的四节点分支；多个分支可以同时处于进行中。
- 删除正式 Action 时不抹除生成历史，而给对应四节点分支写入 `deletedAt`；Character 和 Playtest 不再展示该动作。
- Quick Start 和 Workflow Editor 使用同一个 Controller 和同一份节点状态；前者自动选择并推进，后者由用户逐步确认。
- `WorkflowRun` 直接包含 `nodes`，不存在 `root node → steps` 的第二套节点概念。

## 存取边界

`WorkflowRunStore` 提供异步 `create`、`get`、`getByCharacter`、`list`、`save` 和 `remove`。HTTP 适配器把
真实图节点直接写入后端 `nodes` 数组，运行级元数据暂附在首个真实节点的保留字段中，不制造
额外根节点；读取时兼容早期的 `root + nodes` 快照。

App 已装配 `POST/GET/PATCH/DELETE /workflow-runs` 的真实 HTTP Store。后端没有按 Character
直接查询的接口时，Store 通过列表接口在客户端筛选；内存实现只供测试和显式过渡场景使用。
服务端返回的节点会在进入页面前校验完整形状，残缺快照不会延迟到渲染阶段才报错。

## 文件

- `constants.ts`：状态与六节点标准顺序。
- `index.ts`：公开类型和模块出口。
- `store.ts`：内存实现、HTTP 适配及旧快照兼容。
- `store.test.ts`：存取、错误传播和“真实节点直接落库”测试。
