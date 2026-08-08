# Quick Start

Quick Start 与 Workflow Editor 是两个独立界面，但必须推进同一份 WorkflowRun 节点图。

- Workflow Editor 等待用户逐节点操作。
- Quick Start 隐藏节点细节，由 AI 连续调用同一组 Controller 方法。
- 页面只消费 WorkflowRun 的只读投影，不建立第二套 Store、Revision、Step 或 driver。
- 一次角色与其 Action 保持在同一条 Run；Action 使用 `首帧 -> 资产生成方式 -> 完整动画 -> 审核` 四节点链。
- Quick Start 不向用户增加一次手动选择：AI 当前自动选择可执行的“视频裁剪”路线，并在进度区展示选择结果。3D 转 2D 接口到位后，装配实现可自动改选新路线。

本 PR 保留 `QuickStartService` 页面用例接口。真实实现必须由 App 使用 #107 的
`WorkflowController`、Project、Character、Generation 和发布能力装配。相关能力未配置时页面明确禁用，
不得回退 Mock 或伪造完成结果。

动画审核直接播放完整动画 Generation 的逐帧结果。审核通过后的 Character 写入与 Playtest 目标解析
属于装配用例，不由页面猜测后端字段。
