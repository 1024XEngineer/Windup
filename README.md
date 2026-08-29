<p align="center">
  <img src=".github/assets/windup-mark.svg" width="96" alt="Windup 机械小鸟标志">
</p>

<h1 align="center">Windup</h1>

<p align="center">
  面向国产小游戏开发者的 2D 角色动态素材生成与资产工作台
</p>

<p align="center"><strong>让你的角色，真正登场。</strong></p>

<p align="center">
  <a href="https://windup.xin"><strong>在线使用</strong></a>
  ·
  <a href="https://github.com/1024XEngineer/Windup/issues">问题与建议</a>
  ·
  <a href="openapi.json">OpenAPI</a>
</p>

<p align="center">
  <a href="https://windup.xin"><img src="https://img.shields.io/website?url=https%3A%2F%2Fwindup.xin&amp;up_message=online&amp;down_message=offline&amp;label=windup.xin" alt="windup.xin status"></a>
  <a href="https://github.com/1024XEngineer/Windup/releases/tag/v1.0.0"><img src="https://img.shields.io/badge/release-v1.0.0-4c6b5d" alt="Windup v1.0.0"></a>
  <a href="https://github.com/1024XEngineer/Windup/actions/workflows/frontend-ci.yml"><img src="https://github.com/1024XEngineer/Windup/actions/workflows/frontend-ci.yml/badge.svg?branch=main" alt="Frontend CI"></a>
  <a href="https://github.com/1024XEngineer/Windup/actions/workflows/backend.yml"><img src="https://github.com/1024XEngineer/Windup/actions/workflows/backend.yml/badge.svg?branch=main" alt="Backend CI"></a>
  <a href="https://codecov.io/gh/1024XEngineer/Windup"><img src="https://codecov.io/gh/1024XEngineer/Windup/graph/badge.svg?branch=main" alt="Test coverage"></a>
</p>

<p align="center"><strong>Windup 已于 2026 年 8 月完成 <a href="https://github.com/1024XEngineer/Windup/releases/tag/v1.0.0">v1.0.0</a> 结项交付，在线体验与开源代码继续开放。</strong></p>

<p align="center">
  <img src=".github/assets/readme/character-journey.webp" width="100%" alt="Windup 角色从线稿、母版到游戏资产的生成旅程">
</p>

Windup 面向缺少美术产能的个人开发者和小型团队，把角色构思、动作生成、逐帧审核、试玩与引擎导出收进同一条生产链。用户从文字描述、参考图或已有资产出发，最终得到可以持续补充动作、修正缺陷和重新导出的角色资产。

## 当前能力 / What You Can Do

以下为项目结项时已经进入 `main` 的能力：

| 能力 | 已交付内容 |
| --- | --- |
| 项目与资产库 | 管理项目画风、视角与精灵尺寸，以及角色、造型、动作和分方向帧；已有角色可以继续增加动作 |
| Quick Start | 通过自然语言、参考图或已有角色建立标准制作流程，保存并恢复每一次制作记录 |
| Workflow Editor | 在节点画布中确认单向、四向或八向母版，选择生成方式，并处理动作首帧、完整动画与审核状态 |
| 生成与后处理 | 支持图像、视频与可选三渲二路线，完成去背景、切帧、对齐和可选像素网格重建 |
| 审核与恢复 | 确认候选图与动作结果，按节点或方向局部重试，并保留已经确认的资产 |
| Playtest 与导出 | 在浏览器中试玩单向、四向或八向动作，导出透明 PNG、Sprite Sheet、GIF、动画 JSON 与 ZIP 资源包 |
| Cocos Creator | 为 Cocos Creator 3.8.x 提供本机配对、一键导入与离线资源包回退 |

[`v1.0.0`](https://github.com/1024XEngineer/Windup/releases/tag/v1.0.0) 是本次结项交付的版本基线；[`main`](https://github.com/1024XEngineer/Windup/tree/main) 还包含发布后合入的收尾改动。三渲二、模型选择与高质量抠图依赖部署配置和硬件条件，不代表所有实例默认启用。

## 产品链路 / Product Workflow

```text
文字描述 / 参考图 / 已有角色
             ↓
项目约束 → 单向 / 四向 / 八向角色母版
             ↓
图像生成 / 视频生成 / 可选三渲二
             ↓
分方向动作帧 → 审核 / 局部重生成 / 可选像素网格重建
             ↓
Playtest → PNG / Sprite Sheet / GIF / JSON / ZIP
             ↓
Cocos Creator 3.8.x 一键导入 / 其他游戏工程
```

Windup 用角色母版约束跨方向、跨帧和跨动作的视觉一致性，再用确定性的工程后处理完成去背景、切帧、对齐、网格重建和打包。出现缺陷时，返工可以缩小到具体节点或方向，已经确认的结果继续保留。

## 核心对象 / Core Concepts

| 对象 | 职责 |
| --- | --- |
| `Project` | 统一管理题材、美术风格、视角与精灵尺寸等项目级约束 |
| `Character` | 角色的稳定身份；造型、动作与帧属于它的长期资产树 |
| `CharacterOutfit` | 角色的一套造型及其母版视图，可选关联复用的 3D 资产 |
| `CharacterAction` | 某套造型下的一组动作帧，保存方向、帧序、时长与循环语义 |
| `Generation` | 一次生成任务及其输入、状态和结果，用于恢复与追溯 |
| `WorkflowRun` | 一次制作流程的持久化运行记录，连接生成、确认、回退与导出 |

`Quick Start` 与 `Workflow Editor` 是同一套流程状态的两种入口：前者用于快速建立标准流程，后者用于查看节点依赖、调整生成方式和处理局部返工。

## 技术栈 / Tech Stack

- 前端：React 19、TypeScript 6、Vite 8、Tailwind CSS 4、Three.js、Vitest
- 后端：Python 3.12、FastAPI、Pydantic、SQLAlchemy、uv workspace
- 原生与引擎工具：Rust 像素网格重建器、Cocos Creator 3.8.x 扩展与 Node.js 导入工具
- 基础设施：PostgreSQL、Redis、Docker Compose、Nginx
- 工程约束：GitHub Actions、Ruff、Pytest、Import Linter、oxlint、oxfmt

## 本地开发 / Local Development

需要 Node.js 24、Python 3.12、[uv](https://docs.astral.sh/uv/)、PostgreSQL 16 与 Redis 7。

先准备应用配置。`POSTGRES_*`、`REDIS_URL` 与 `JWT_SECRET` 是启动后端所需的基础配置；生成、存储与邮件能力还需要各自的服务凭据。

```bash
cp .env.example .env
# 修改 POSTGRES_* 与 REDIS_URL，并新增至少 32 字符的 JWT_SECRET
```

PostgreSQL 与 Redis 已从应用层 Compose 拆出。需要复用仓库的数据层配置时，复制 `.env.db.example`，让应用 `.env` 中的 `POSTGRES_PASSWORD`、`POSTGRES_PORT` 与 `REDIS_URL` 对应同一组连接信息，再启动独立数据层：

```bash
cp .env.db.example .env.db
docker compose --env-file .env.db -f docker-compose.db.yml up -d
```

启动后端：

```bash
cd backend
uv sync --frozen
uv run uvicorn windup_app.bootstrap.app:create_app --factory --reload
```

另开一个终端启动 Worker。生成任务与验证码邮件都通过 Redis Stream 消费；不启动 Worker 时，任务会停在排队状态。

```bash
cd backend
uv run python -m windup_app.worker
```

再启动前端：

```bash
cd frontend
npm ci
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

前端开发服务器默认访问 `http://localhost:5173`，后端健康检查为 `http://localhost:8000/health`。`VITE_API_BASE_URL` 是构建期变量，连接其他后端时需要在启动或构建前设置。

## 质量检查 / Quality Checks

按改动影响范围运行对应目录的检查：

```bash
# frontend/
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build

# backend/
uv run ruff check .
uv run python -m scripts.export_openapi
uv run lint-imports
uv run pytest -q --cov=packages

# native/pixel-perfect/crates/reconstructor/
cargo fmt --check
cargo test --release --locked

# tools/cocos-importer/
npm test
cd extension
npm test
npm run build
npm run verify-package
```

## 仓库结构 / Repository Structure

```text
Windup/
├── frontend/                  # React 前端、产品页面与制作流程
├── backend/                   # FastAPI 应用、领域服务、生成引擎与基础设施
├── native/                    # Rust 原生像素网格重建器
├── tools/                     # Cocos Creator 导入器等独立工具
├── docs/                      # 规格、计划与验收材料
├── openapi.json               # 从后端自动生成的接口契约
├── VERSION                    # 当前产品版本
├── docker-compose.yml         # 后端、Worker 与前端应用层
└── docker-compose.db.yml      # PostgreSQL 与 Redis 数据层
```

## 相关文档 / Documentation

- [在线产品](https://windup.xin)
- [产品使用手册](https://windup.xin/guide)
- [v1.0.0 结项版本](https://github.com/1024XEngineer/Windup/releases/tag/v1.0.0)
- [Windup 产品策划案](https://github.com/1024XEngineer/Windup/issues/37)
- [核心流程与工作流](https://github.com/1024XEngineer/Windup/issues/25)
- [Cocos Creator 一键导入](tools/cocos-importer/README.md)
- [像素网格重建器](native/pixel-perfect/crates/reconstructor/README.md)
- [OpenAPI 接口契约](openapi.json)

## 参与贡献 / Contributing

Bug、需求和实验建议统一进入 [Issues](https://github.com/1024XEngineer/Windup/issues)。功能和核心改动按 `Proposal → Issue → Branch → Pull Request → Review` 推进，详细流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

项目的维护与历史贡献见 [Contributors](https://github.com/1024XEngineer/Windup/graphs/contributors)。

## 许可证 / License

[Apache License 2.0](LICENSE)
