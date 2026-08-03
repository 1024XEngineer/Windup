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
npm run test           # 测试（本阶段无测试文件）
npm run build          # 构建
```

CI 按上面顺序全跑一遍。

## 结构

模块划分、依赖规则、状态归属和当前产品范围见仓库根目录
`frontend-architecture-v3.md`。前端采用 `app -> pages -> features -> entities -> shared`
五层结构；架构边界由 `src/architecture-boundaries.test.ts` 自动检查。

功能实现按独立页面、Feature 或 Entity 拆成后续小 PR，不与架构规则一次性提交。

与后端尚未对齐的接口见 `API_CONTRACT.md`。
