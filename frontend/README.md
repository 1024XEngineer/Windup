# Windup 前端

React + Vite + TypeScript。

## 开发

```bash
npm ci
npm run dev
```

## 检查

```bash
npm run format:check   # 格式
npm run lint           # 静态检查
npm run typecheck      # 类型
npm run test           # 单元与纵向集成测试
npm run build          # 构建
```

CI 按上面顺序全跑一遍。

## 结构

六个业务模块见 `MODULES.md`，代码依赖规则见 `ARCHITECTURE_GUARDRAILS.md`。

当前 Project、Character、Generation、Media 已接真实后端适配器。Quick Start 与 Workflow
Editor 共享同一套 `WorkflowRun` 和 Controller；项目页、资产库、历史记录与 Playtest 分别
承担不同产品职责。Playtest 提供只读检查与独立下载包能力。

与后端尚未对齐的接口见 `API_CONTRACT.md`。
