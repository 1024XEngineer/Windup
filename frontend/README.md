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

模块划分、依赖规则与命名约定见仓库根目录 `frontend-architecture-v3.md`。

**本阶段只提交模块边界与接口，不含实现。** 页面是占位外壳，各模块只有类型与 `XxxApis` 接口。实现按模块拆成后续 PR。

与后端尚未对齐的接口见 `API_CONTRACT.md`。
