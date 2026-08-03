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

页面和大部分模块仍是接口骨架。`entities/workflow-run` 已包含版本化 Store、刷新恢复、
Revision 历史和对应测试；Controller 与页面实现继续按独立 PR 提交。

与后端尚未对齐的接口见 `API_CONTRACT.md`。
