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
FROM python:3.12-slim AS runtime

WORKDIR /app

# 从 builder 拷贝虚拟环境和包
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/packages /app/packages

# 把 venv/bin 加入 PATH
ENV PATH="/app/.venv/bin:$PATH"

# 这次构建对应的 commit。镜像里没有 .git,不在构建期烘进来的话,任务落库时的
# 版本恒为 unknown,线上数据就没法按版本归因(#501)。
ARG WINDUP_BUILD_COMMIT=""
ENV WINDUP_BUILD_COMMIT=${WINDUP_BUILD_COMMIT}

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
