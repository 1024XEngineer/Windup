# ── 后端 Dockerfile ──────────────────────────────────────────────────
# 多阶段构建:builder 装依赖 → runtime 只拷贝产物，镜像更小

# ── 阶段 1: 构建 ──
FROM python:3.12-slim AS builder

# 安装 uv（比 pip 快 10x）
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /build

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
COPY --from=builder /build/.venv /app/.venv
COPY --from=builder /build/packages /app/packages

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
