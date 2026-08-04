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
npm run test           # 测试
npm run build          # 构建
```

CI 按上面顺序全跑一遍。

## 结构

模块划分、依赖规则与命名约定见仓库根目录 `frontend-architecture-v3.md`。

模块边界与接口已经落地，页面实现按模块拆成多个 PR 陆续进来。**目前只有首页是真实现，其余七个路由仍是占位外壳**，`entities` 与 `features` 也只有类型和 `XxxApis` 接口，没有真实请求。

页面自己决定宽度与留白，`AppShell` 只提供顶栏，不再统一夹一个居中容器。

与后端尚未对齐的接口见 `API_CONTRACT.md`。
