# ── 后端 Dockerfile ──────────────────────────────────────────────────
# 多阶段构建：builder 装依赖 → runtime 只拷贝产物，镜像更小。
#
# 两处不是随手写的，都是在部署服务器上实测踩出来的（2026-08-04）：
#
# 1. builder 与 runtime **必须同路径**。uv 装出来的 venv 里，可执行脚本的 shebang
#    与 workspace 包的 .pth 都是**绝对路径**。若 builder 在 /build、runtime 在 /app，
#    拷过去之后 uvicorn 会报 "no such file or directory" —— 报的不是脚本本身，
#    而是它 shebang 指向的 /build/.venv/bin/python；同时 workspace 包 import 不到。
#
# 2. 国内网络必须换源并拉长超时。实测宿主机访问 pypi.org 需 8s，构建容器内默认
#    超时会在下载大包（uvloop）时 "operation timed out" 直接失败。

FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_DEFAULT_INDEX=https://mirrors.aliyun.com/pypi/simple/ \
    UV_HTTP_TIMEOUT=180

# 与 runtime 同路径 —— 见文件头第 1 条
WORKDIR /app

# 先拷依赖定义，利用 layer cache
COPY pyproject.toml uv.lock ./
COPY packages/common/pyproject.toml packages/common/
COPY packages/framework/pyproject.toml packages/framework/
COPY packages/ai_engine/pyproject.toml packages/ai_engine/
COPY packages/app/pyproject.toml packages/app/

RUN uv sync --frozen --no-dev --no-install-workspace

COPY packages/ packages/
RUN uv sync --frozen --no-dev

# ── 运行时 ──
FROM python:3.12-slim AS runtime

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/packages /app/packages

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# 打 /health 而不是 /docs：生产通常关掉交互文档(docs_url=None)，那时探针会永远失败。
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "windup_app.bootstrap.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
