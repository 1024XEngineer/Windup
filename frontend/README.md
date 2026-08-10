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

## 容器部署

跟后端、数据库同一份根目录 `docker-compose.yml`：

```bash
cp .env.example .env      # 在仓库根目录，按需改 WINDUP_WEB_PORT
docker compose up -d --build
```

起来后访问 `http://<host>:${WINDUP_WEB_PORT:-8080}`。前端容器里是 nginx：静态资源加 SPA 回退，另把 `/api/` 反代到内网 `backend:8000`，所以浏览器只看见一个源，跨域配置一概不需要。

`VITE_API_BASE_URL` 是构建期变量，`vite build` 时就烘进产物，运行期给容器注环境变量无效。默认取 `/api` 走上面的反代；确实要指向外部后端时，构建时传 `--build-arg VITE_API_BASE_URL=https://…`，同时后端得配 `WINDUP_CORS_ORIGINS`。

Vercel 部署路径不受影响，`vercel.json` 照旧。

## 结构

`ProjectApis` 与 `CharacterApis` 负责业务 DTO 映射。项目中心、项目工作区、资产库与角色详情已接入 PR #75 的真实接口；测试数据只存在于测试环境的 HTTP 替身中。

页面自己决定宽度与留白，`AppShell` 只提供顶栏，不再统一夹一个居中容器。

`shared/api` 提供后续业务接口可复用的公共 HTTP 请求能力。

运行项目前需要配置 `VITE_API_BASE_URL`。Bearer token 由登录模块取得后，通过 `registerApiAccessTokenProvider` 注册读取函数；业务请求统一从该边界读取。本轮不定义 token 的保存方式。

与后端尚未对齐的接口见 `API_CONTRACT.md`。
