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

`ProjectApis` 与 `CharacterApis` 负责业务 DTO 映射。项目中心、项目工作区、资产库与角色详情已接入 PR #75 的真实接口；测试数据只存在于测试环境的 HTTP 替身中。

页面自己决定宽度与留白，`AppShell` 只提供顶栏，不再统一夹一个居中容器。

与后端尚未对齐的接口见 `API_CONTRACT.md`。
