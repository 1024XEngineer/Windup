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

## 容器构建与宿主机部署

服务器由宿主机 nginx 提供静态资源并反代 `/api`。前端容器只构建产物：

```bash
cp .env.example .env
sudo mkdir -p /var/www/react-windup
docker compose up -d --build frontend
```

构建命令会清空专用站点目录 `/var/www/react-windup`，再把文件直接写入宿主机；完成后容器正常退出，没有端口映射，也不常驻。宿主机 nginx 的站点根目录需指向该目录，并负责 SPA 回退与 `/api` 反代。之后每次更新仍执行上面的 Compose 命令，nginx 会直接读取新产物。

`VITE_API_BASE_URL` 是构建期变量，`vite build` 时就烘进产物，运行期给容器注环境变量无效。默认取 `/api` 走宿主机反代；确实要指向外部后端时，构建时传 `--build-arg VITE_API_BASE_URL=https://…`，同时后端得配 `WINDUP_CORS_ORIGINS`。

Vercel 部署路径不受影响，`vercel.json` 照旧。

## 结构

`ProjectApis` 与 `CharacterApis` 负责业务 DTO 映射。项目中心、项目工作区、资产库与角色详情已接入 PR #75 的真实接口；测试数据只存在于测试环境的 HTTP 替身中。

页面自己决定宽度与留白，`AppShell` 只提供顶栏，不再统一夹一个居中容器。

`shared/api` 提供后续业务接口可复用的公共 HTTP 请求能力。

运行项目前需要配置 `VITE_API_BASE_URL`。Bearer token 由登录模块取得后，通过 `registerApiAccessTokenProvider` 注册读取函数；业务请求统一从该边界读取。本轮不定义 token 的保存方式。

前后端接口契约以仓库根目录自动生成的 `openapi.json` 为准，也可在本地后端的
FastAPI `/docs` 页面中查看。
