# Windup 架构图

浏览器直接打开 HTML（自带暗/亮色与导出）。JSON 是图的源文件。

| 图 | 打开 | 源 |
|---|---|---|
| 整体架构（外部调用） | [windup-system.html](./windup-system.html) | [windup-system.architecture.json](./windup-system.architecture.json) |
| 内部服务 | [windup-internals.html](./windup-internals.html) | [windup-internals.architecture.json](./windup-internals.architecture.json) |

- **整体架构**：浏览器 → Nginx → FastAPI；生成与邮件经 Redis Stream 交给独立 Worker，再经 AI Gateway 调上游。
- **内部服务**：项目/鉴权/积分、前端节点编排与 Agent、任务调度、资产后处理，以及浏览器 WebGL 三渲二出帧。
