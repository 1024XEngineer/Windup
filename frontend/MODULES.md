# Windup 前端模块契约

> 状态：Issue #58 骨架契约。Project 已对接后端 PR #57；Character、WorkflowRun、
> ActionTemplate、Wearable 与 SSE 仍是待前后端 Review 的提案。

## 分层与模块不是一件事

`app / pages / features / entities / shared` 回答代码放在哪一层、可以向哪里依赖。
模块回答哪一块代码共同维护一项稳定能力，以及外部只能通过什么入口使用它。

当前只声明四组模块边界：

1. `entities`：一个数据模块。
2. `pages/workflow-editor/editor`：Workflow Editor 页面内模块。
3. `pages/playtest/inspection-preview`：检查/预览台页面内模块。
4. `AppShell` 与 `PageHeader`：两个独立的公开 UI 组件，不冒充一个统一 Header 模块。

`pages`、`features`、`shared` 整层不是模块。Quick Start、Projects、Asset Library
当前也只是页面；CharacterSetup、Generation、Review、Export 是业务 Feature，
不因为各有一个目录就自动升级为架构模块。

## 1. Entities 数据模块

**职责**：把后端与本地暂存抽象成前端唯一的业务数据入口，提供类型、查询、命令与
界面无关的 Workflow 规则。

**唯一外部入口**：`@/entities`。

`project / character / workflow-run / action-template / wearable` 是模块内部业务分区，
上层不得直接 import `@/entities/project` 或更深文件。全部公开 export 列在
`src/entities/index.ts`。

**对 #45 规则的有意修订**：架构文档第 3 节「同一层的不同 Slice 不能互相 import」
对 entities 不再适用——既然整个 entities 是一个模块，它的内部分区之间可以互相引用，
对外仍只有一个入口。依赖检查据此只对 `pages`、`features` 强制同层隔离。

**不负责**：路由、画布交互、播放按键、页面组装。

## 2. Workflow Editor

**职责**：用户手动组织、查看并运行 Workflow 的编辑器；内部管理画布、节点、连线、
选中与定位，并在当前 Page Slice 内组装 Generation、Review 与 Export。

**页面内入口**：`pages/workflow-editor/editor/index.tsx`。路由适配器只通过该入口使用它。

```ts
export type WorkflowEditorFocus =
  | { kind: 'step'; stepId: WorkflowStep['id'] }
  | {
      kind: 'frame'
      stepId: WorkflowStep['id']
      actionId: Action['id']
      frameIndex: Frame['index']
    }

export interface WorkflowEditorProps {
  runId: WorkflowRun['id']
  focus?: WorkflowEditorFocus
  onOpenPreview: (characterId: Character['id']) => void
}
```

调用方先创建 run，再以同一 `runId` 进入；已有 run 直接按 `runId` 恢复。退回时额外传
`focus`。`runId` 或 `focus` 变化后模块必须重新加载/定位，不能沿用上一个 run 的界面状态。

**不负责**：读取 Router、页头、浏览器前进后退、跨页跳转、Workflow 业务真相。

## 3. Inspection Preview

**职责**：以角色为入口，管理动作切换、播放/暂停、按键绑定、当前帧与逐帧定格；
需要回改时只向页面上报已解析的 `WorkflowLocation`。

**页面内入口**：`pages/playtest/inspection-preview/index.tsx`。

```ts
export interface InspectionPreviewProps {
  characterId: Character['id']
  onOpenWorkflowAtFrame: (location: WorkflowLocation) => void
}
```

逐帧审核的写入能力由受控的 Review Feature / Entities 提供；当前宿主是选中动作/帧的
唯一状态所有者，Review 只通过 Props 显示和上报事件，不复制第二套选择或审核数据。

**不负责**：读取 Router、自行跳转 Workflow Editor、重复定义 Character/Action/Frame。

## 4. AppShell 与 PageHeader

- `AppShell({ children })`：全站外壳和常驻导航，入口为 `app/layout/index.tsx`。
- `PageHeader({ title, subtitle, onBack, actions })`：页内位置、返回与特有操作，入口为
  `shared/ui/index.ts`。

两者暂时保持独立。在现有依赖方向下，不为了形式上的“一个 Header 模块”引入全局 Context。

## 验收规则

- 两个页面内模块不 import `react-router`，脱离 Router 也能渲染与测试。
- 上层只能精确 import `@/entities`，不得读内部 Slice。
- Page 保留 URL、Header 与导航；模块内部替换实现时，Page 接口不变。
- Workflow 的真相与界面无关规则留在 entities，画布/播放状态留在对应 UI 模块。
- 架构测试同时检查别名、相对路径、动态 import、公开入口与循环依赖。

## 未冻结项

- Character、Action、Frame、WorkflowRun、TaskEvent 等后端 Schema。
- `Action.sourceWorkflowId → WorkflowRun → WorkflowLocation` 的单帧回改链。
- 检查/预览台真实播放、PixiJS 与按键绑定。
- Workflow Editor 的画布库、节点面板和编辑状态实现。

未冻结项不在 Issue #58 中实现，只保留待 Review 的候选契约形状。
