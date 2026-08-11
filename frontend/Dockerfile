# ── 前端构建容器 ─────────────────────────────────────────────────────
# 容器只负责生成静态产物，宿主机 nginx 直接读取挂载目录。
# Node 版本跟 frontend-ci.yml 对齐,避免 CI 过了、镜像里构建结果不同
FROM node:24-alpine

# 国内网络:走镜像源,与 backend/Dockerfile 换阿里 pypi 源同因
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

WORKDIR /app

# 先只拷依赖清单,命中 Docker layer cache —— 改源码不触发重装依赖
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_ 前缀的变量在 vite build 时就被烘进 dist,运行期再往容器注环境变量对
# 已构建产物无效 —— 这是前端和 backend 在配置方式上唯一的实质差别。
# 默认值 /api 是相对路径:浏览器请求与页面同源,由宿主机 nginx 转发给后端,
# 构建镜像因此不与任何域名绑定,同一份产物可直接换环境跑。
# 若某个环境确实要指向外部后端,构建时传 --build-arg VITE_API_BASE_URL=https://…,
# 但那样后端必须同步配 WINDUP_CORS_ORIGINS,否则浏览器预检就被拦死。
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# build 脚本是 tsc -b && vite build,类型不过直接构建失败。产物直接写进
# Compose 挂载的宿主机目录；构建完成后进程退出，不启动常驻服务。
CMD ["npm", "run", "build", "--", "--outDir", "/var/www/react-windup", "--emptyOutDir"]
