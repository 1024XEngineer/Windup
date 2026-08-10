# ── 前端 Dockerfile ──────────────────────────────────────────────────
# 多阶段构建:builder 产出 dist → runtime 只带静态文件和 nginx,运行时不含 Node

# ── 阶段 1: 构建 ──
# Node 版本跟 frontend-ci.yml 对齐,避免 CI 过了、镜像里构建结果不同
FROM node:24-alpine AS builder

# 国内网络:走镜像源,与 backend/Dockerfile 换阿里 pypi 源同因
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

# 先只拷依赖清单,命中 Docker layer cache —— 改源码不触发重装依赖
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_ 前缀的变量在 vite build 时就被烘进 dist,运行期再往容器注环境变量对
# 已构建产物无效 —— 这是前端和 backend 在配置方式上唯一的实质差别。
# 默认值 /api 是相对路径:浏览器请求与页面同源,由同容器的 nginx 转发给后端,
# 镜像因此不与任何域名绑定,同一份产物可直接换环境跑。
# 若某个环境确实要指向外部后端,构建时传 --build-arg VITE_API_BASE_URL=https://…,
# 但那样后端必须同步配 WINDUP_CORS_ORIGINS,否则浏览器预检就被拦死。
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# build 脚本是 tsc -b && vite build,类型不过直接构建失败
RUN npm run build

# ── 阶段 2: 运行时 ──
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# 探首页而不是 /healthz:静态站点没有独立健康端点,首页能返回 200
# 就说明 nginx 起来了且 dist 拷进来了。
# 必须写 127.0.0.1 不能写 localhost:busybox 的 wget 会优先解析到 ::1,而 nginx.conf
# 只 listen 80(IPv4),探针会一直 "Connection refused",容器永远 unhealthy——
# 实测踩过,站点从宿主机访问完全正常,只有探针在报错。
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
