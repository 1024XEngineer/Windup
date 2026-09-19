# Windup 前端架构图

这张图回答三件事：用户如何从两种入口进入同一条创作流程，浏览器如何把后端任务收口为可恢复的 `WorkflowRun`，以及审核结果如何成为可核验、可导出的 Character 资产。

| 产物 | 用途 |
|---|---|
| [windup-frontend.html](./windup-frontend.html) | 独立查看器；支持亮/暗主题、四种阅读视图、节点源码索引和 SVG / PNG 导出 |
| [windup-frontend.architecture.json](./windup-frontend.architecture.json) | 人可读的架构源文件；保存节点、边界、连线、阅读视图、事实说明和源码锚点 |
| [render.mjs](./render.mjs) | 无第三方依赖的确定性渲染器；校验源文件后生成独立 HTML，也可额外导出 SVG |

## 怎么读

- **全景**：从 App 外壳、双入口、共享编排、生成恢复走到发布和交付。
- **双入口合流**：Quick Start 自动连续调用，Workflow Editor 等待用户逐步操作；两者共享 `WorkflowController` 和 `WorkflowRun.nodes`。
- **状态闭环**：任务在后端执行，但浏览器仍要订阅终态、对账并把节点变化持久化回 `WorkflowRun`。
- **资产交付**：已审核动作进入 Character → Outfit → Action → Sequence → Frame 资产树，再被资产库、Playtest 和导出包消费。

图中刻意保留 Quick Start 与 Workflow Editor 的发布分叉：它们共用生成编排，但当前仍通过两条适配路径写入 Character。这里不把“共享 Controller”夸成尚未实现的端到端统一。

## 重新生成

从仓库根目录执行：

```bash
node frontend/docs/architecture/render.mjs
```

需要同时得到普通 SVG 时：

```bash
node frontend/docs/architecture/render.mjs \
  frontend/docs/architecture/windup-frontend.architecture.json \
  frontend/docs/architecture/windup-frontend.html \
  --svg /tmp/windup-frontend.svg
```

渲染器会拒绝重复组件或连线 ID、不存在的连接端点、缺少几何路径的连线，以及引用未知组件的阅读视图。架构发生变化时，先更新 JSON 中的源码锚点和 `meta.repository.revision`，再重新生成 HTML。

## 文档边界

- 这不是 React 组件目录树，也不枚举每个页面内部状态。
- 这不是后端部署或服务拓扑图；蓝色虚线只表示前端实际消费的公开 HTTP / SSE 合同。
- 图中的源码链接固定到 JSON 声明的 Git revision，避免后续行号漂移让旧图指向错误实现。
