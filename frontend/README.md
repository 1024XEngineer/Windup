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

模块划分、依赖规则与命名约定见仓库根目录 `frontend-architecture-v3.md`。

当前已实现纯前端 `WorkflowRun` 存储，以及
`角色资料 → 角色图生成 → 候选选择` 的首个 Controller 纵切。页面仍是占位外壳，
后五步和真实 `XxxApis` 实现按模块拆成后续 PR。

与后端尚未对齐的接口见 `API_CONTRACT.md`。
