# ── 后端 Dockerfile ──────────────────────────────────────────────────
# 多阶段构建:builder 装依赖 → runtime 只拷贝产物，镜像更小

# ── 阶段 0: 构建两个独立的本地像素工具 ──
FROM rust:1.89-slim AS pixel-tools-builder

WORKDIR /build
COPY native/pixel_grid_detector/ pixel_grid_detector/
COPY native/pixel_grid_reconstructor/ pixel_grid_reconstructor/
RUN cargo build --release --locked --manifest-path pixel_grid_detector/Cargo.toml \
    && cargo build --release --locked --manifest-path pixel_grid_reconstructor/Cargo.toml

# ── 阶段 1: 构建 Python 环境 ──
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
COPY --from=pixel-tools-builder /build/pixel_grid_detector/target/release/windup-pixel-grid-detector /usr/local/bin/windup-pixel-grid-detector
COPY --from=pixel-tools-builder /build/pixel_grid_reconstructor/target/release/windup-pixel-grid-reconstructor /usr/local/bin/windup-pixel-grid-reconstructor
COPY native/pixel_grid_detector/LICENSE /licenses/pixel-grid-detector/LICENSE
COPY native/pixel_grid_reconstructor/LICENSE /licenses/pixel-grid-reconstructor/LICENSE

# 把 venv/bin 加入 PATH
ENV PATH="/app/.venv/bin:$PATH"

# 默认环境变量（可被 docker-compose / .env 覆盖）
ENV WINDUP_HOST=0.0.0.0
ENV WINDUP_PORT=8000
ENV WINDUP_RELOAD=false
ENV PIXEL_GRID_DETECTOR_BIN=/usr/local/bin/windup-pixel-grid-detector
ENV PIXEL_GRID_RECONSTRUCTOR_BIN=/usr/local/bin/windup-pixel-grid-reconstructor

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/docs')" || exit 1

# 启动命令
CMD ["uvicorn", "windup_app.bootstrap.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
