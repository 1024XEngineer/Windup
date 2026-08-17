<p align="center">
  <img src=".github/assets/windup-mark.svg" width="96" alt="Windup 机械小鸟标志">
</p>

<h1 align="center">Windup</h1>

<p align="center">
  面向国产小游戏开发者的 2D 角色动态素材生成与资产工作台
</p>

<p align="center"><strong>交付的是资产，而不是图片。</strong></p>

Windup 面向缺少美术产能的个人开发者和小型团队，把角色构思、动作生成、逐帧质检、试玩与引擎导出收进同一条生产链。用户从文字描述或参考图出发，最终得到可以持续补充动作、修正缺陷和重新导出的角色资产。

## 产品链路 / Product Workflow

```text
新角色：文字描述 / 参考图 → 项目约束 → 角色母版
已有角色：从资产库继续生产 ─────────────┘
                              ↓
                     动作序列帧 → 逐帧审核 / 局部重生成
                              ↓
             Playtest 试玩 → PNG / Sprite Sheet / 元数据 → 游戏引擎
```

Windup 用角色母版约束跨帧、跨动作的视觉一致性，再用确定性的工程后处理完成去背景、切帧、对齐和打包。出现缺陷时，返工可以缩小到具体帧或节点，已通过的结果继续保留。

## 核心对象 / Core Concepts

| 对象 | 职责 |
| --- | --- |
| `Project` | 统一管理题材、美术风格、视角与精灵尺寸等项目级约束 |
| `Character` | 角色资产本体；造型、动作实例与帧属于它的资产树 |
| `ActionTemplate` | 可在不同角色间复用的动作规格与生产配方 |
| `Generation` | 一次生成任务及其输入、状态和结果，用于恢复与追溯 |
| `WorkflowRun` | 一次前端制作流程的运行记录，连接生成、确认、回退与导出 |

产品提供两种入口：`Quick Start` 用自然语言建立标准生产流程；`Workflow Editor` 在系统预置的成熟管线上追加动作分支、微调参数和局部返工。两者共用同一套流程状态和质量门禁，分别服务快速创建与精细控制。

## 当前阶段 / Project Status

MS2 已完成 Windup 的产品 MVP，验证了角色资产生产的核心链路。MS3 的重点从“完成一次生成”转向“持续完善已有角色资产”：用户可以从资产库回到已有角色，为它补充动作、重做有问题的分支，并保留未受影响的资产。

| 状态 | 内容 |
| --- | --- |
| MS2 产出 | 完成产品 MVP，跑通并验证角色资产生产的核心体验 |
| MS3 产品主线 | 已有角色补动作；工作流采用固定成熟管线，通过卡片加号追加分支，支持参数微调与局部重跑 |
| MS3 工程重点 | 持久化 `WorkflowRun` 并关联角色，串起工作流编辑、产物审核、节点回退与 Playtest |
| 后续探索 | Quick Start Agent、3D 动作生成路线、多视角资产与项目级导出 |

项目进度见 [`main`](https://github.com/1024XEngineer/Windup/tree/main) 与 [Issues](https://github.com/1024XEngineer/Windup/issues)。

## 技术栈 / Tech Stack

- 前端：React 19、TypeScript 6、Vite 8、Tailwind CSS 4、Vitest
- 后端：Python 3.12、FastAPI、Pydantic、SQLAlchemy、uv workspace
- 工程约束：GitHub Actions、Ruff、Pytest、Import Linter、oxlint、oxfmt

## 本地开发 / Local Development

前端支持 Node.js `^20.19.0`、`^22.12.0` 或 `>=24.0.0`；CI 使用 Node.js 24：

```bash
cd frontend
npm ci
npm run dev
```

后端使用 Python 3.12 和 [uv](https://docs.astral.sh/uv/)：

```bash
cd backend
uv sync --frozen
uv run uvicorn windup_app.bootstrap.app:create_app --factory --reload
```

## 质量检查 / Quality Checks

```bash
# frontend/
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build

# backend/
uv run ruff check .
uv run lint-imports
uv run pytest -q
```

## 仓库结构 / Repository Structure

```text
Windup/
├── frontend/                  # React 前端、页面与制作流程
├── backend/                   # Python 工作区、领域服务与 API
└── README.md
```

## 相关文档 / Documentation

- [Windup 产品策划案](https://github.com/1024XEngineer/Windup/issues/37)
- [核心流程与工作流](https://github.com/1024XEngineer/Windup/issues/25)
- [OpenAPI 接口契约](openapi.json)

## 参与贡献 / Contributing

问题、需求和实验记录统一进入 [Issues](https://github.com/1024XEngineer/Windup/issues)。功能和核心改动按 `Proposal → Issue → Branch → Pull Request → Review` 推进，开发前请先查看对应 Issue 与领域契约。

项目的维护与历史贡献见 [Contributors](https://github.com/1024XEngineer/Windup/graphs/contributors)。

## 许可证 / License

[Apache License 2.0](LICENSE)
