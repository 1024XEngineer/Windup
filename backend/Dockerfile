# ── 后端 Dockerfile ──────────────────────────────────────────────────
# 多阶段构建:builder 装依赖 → runtime 只拷贝产物，镜像更小

# ── 阶段 1: 构建 ──
FROM python:3.12-slim AS builder

# 安装 uv（比 pip 快 10x）
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# ── 国内网络：走镜像源 + 拉长超时 ────────────────────────────────────────
# 实测（2026-08-04，这台服务器）：宿主机访问 pypi.org 需 8s，构建容器内默认超时
# 会在下载大包（uvloop）时 "operation timed out" 直接失败。
ENV UV_DEFAULT_INDEX=https://mirrors.aliyun.com/pypi/simple/ \
    UV_HTTP_TIMEOUT=180

# 必须与 runtime 阶段同路径 —— venv 内的 shebang/.pth 是绝对路径，跨路径拷贝会失效
WORKDIR /app

# 先拷贝依赖定义，利用 Docker layer cache
COPY pyproject.toml uv.lock ./
COPY packages/common/pyproject.toml packages/common/
COPY packages/framework/pyproject.toml packages/framework/
COPY packages/ai_engine/pyproject.toml packages/ai_engine/
COPY packages/app/pyproject.toml packages/app/

# 安装依赖（不含 dev 依赖）
RUN uv sync --frozen --no-dev --no-install-workspace

# 拷贝源码并安装
COPY packages/ packages/
RUN uv sync --frozen --no-dev

# ── 阶段 2: 运行时 ──
# 拆成 runtime-base → {runtime-render3d, runtime} 三段，且把精简的 runtime 放在最后：
# 最后一个阶段是 docker build 的默认目标，出帧依赖有 700MB 量级，不该让不出帧的
# backend 也背上。BuildKit 不构建用不到的阶段，所以默认构建不会碰 render3d 那段。
FROM python:3.12-slim AS runtime-base

WORKDIR /app

# 从 builder 拷贝虚拟环境和包
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/packages /app/packages

# 把 venv/bin 加入 PATH
ENV PATH="/app/.venv/bin:$PATH"

# 默认环境变量（可被 docker-compose / .env 覆盖）
ENV WINDUP_HOST=0.0.0.0
ENV WINDUP_PORT=8000
ENV WINDUP_RELOAD=false

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/docs')" || exit 1

# 启动命令
CMD ["uvicorn", "windup_app.bootstrap.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

# ── 阶段 2b: 出帧运行时（三渲二的服务端渲，回退路径）──
# 出帧段是「起本地 HTTP 服务 → node + playwright 驱动出帧台 → 读回 PNG」，
# 所以 node / playwright / three 是硬依赖，缺任何一个该路线在运行时才报错。
#
# 默认已不再构建它：应用机 4 核无 GPU，只能走 SwiftShader 软件光栅（实测峰值想吃 7.6
# 个核），而这一层让 worker 镜像从 820MB 涨到 2.53GB（其中 /ms-playwright 656MB）。
# 出帧改由用户浏览器承担（#714）；本阶段留给 WINDUP_RENDER3D_CLIENT_BAKE=0 的回退。
FROM runtime-base AS runtime-render3d

ARG PLAYWRIGHT_VERSION=1.62.1
ARG THREE_VERSION=0.185.1
# 与上面 UV_DEFAULT_INDEX 同一个理由：默认源在这台机器上慢到会让构建超时失败。
# 浏览器二进制不走 npm 源，要单独指 PLAYWRIGHT_DOWNLOAD_HOST。
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
ENV npm_config_registry=${NPM_REGISTRY} \
    PLAYWRIGHT_DOWNLOAD_HOST=${PLAYWRIGHT_DOWNLOAD_HOST}

# node 从官方镜像拷而不是 apt 装：bookworm 的 nodejs 是 18.20.4，而 playwright 1.62
# 声明 engines.node >=20。只拷 node 与 npm 两个路径，不整体覆盖 /usr/local ——
# python 自己就装在那里。libstdc++6 是 node 的运行时依赖，slim 基础镜像里没有。
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# 浏览器装到镜像内的固定路径而不是 $HOME/.cache：容器以哪个用户跑不该改变它的位置。
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# 全局装 playwright，落点 /usr/local/lib/node_modules/playwright/index.mjs 正是
# _discover_playwright 查的第二条路径，不需要再传 PLAYWRIGHT_MODULE。
# three 反过来要显式指：_discover_three 是从 cwd 往上找 */node_modules/three，
# 找不到全局落点。
ENV WINDUP_THREE_DIR=/usr/local/lib/node_modules/three
RUN npm install -g --no-fund --no-audit \
        "playwright@${PLAYWRIGHT_VERSION}" "three@${THREE_VERSION}" \
    && node /usr/local/lib/node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# 只有本阶段的自检：三样缺一个，出帧就会在运行时才失败。
RUN node -e "import('/usr/local/lib/node_modules/playwright/index.mjs').then(()=>console.log('playwright ok'))" \
    && test -f "$WINDUP_THREE_DIR/build/three.module.js" \
    && test -d "$WINDUP_THREE_DIR/examples/jsm" \
    && test -d "$PLAYWRIGHT_BROWSERS_PATH" \
    && echo "three + 浏览器 ok"

# ── 阶段 2c: 默认运行时（精简）──
# 放在最后 = docker build 不带 --target 时的默认目标。
FROM runtime-base AS runtime
