<p align="center">
  <img src=".github/assets/windup-mark.svg" width="96" alt="Windup 机械小鸟标志">
</p>

<h1 align="center">Windup</h1>

<p align="center">
  面向国产小游戏开发者的 2D 角色动态素材生成与资产工作台
</p>

<p align="center"><strong>交付的是资产，而不是图片。</strong></p>

Windup 面向缺少美术产能的个人开发者和小型团队，把角色构思、动作生成、逐帧质检、试玩与引擎导出收进同一条生产链。用户从文字描述或参考图出发，最终得到可继续补动作、修缺陷、重新导出的角色资产，而不是一次性的生成结果。

## 产品链路

```text
文字描述 / 参考图
        ↓
项目约束（风格、视角、精灵尺寸）
        ↓
角色母版 → 动作序列帧 → 逐帧审核 / 局部重生成
        ↓
Playtest 试玩 → 透明 PNG / Sprite Sheet / 元数据 → 游戏引擎
```

Windup 用角色母版约束跨帧、跨动作的视觉一致性，再用确定性的工程后处理完成去背景、切帧、对齐和打包。当某一帧出问题时，返工单位应该缩小到该帧或该节点，不让已经通过的结果陪着重做。

## 核心对象

| 对象 | 职责 |
| --- | --- |
| `Project` | 统一管理题材、美术风格、视角与精灵尺寸等项目级约束 |
| `Character` | 角色资产本体；造型、动作实例与帧属于它的资产树 |
| `ActionTemplate` | 可在不同角色间复用的动作规格与生产配方 |
| `Generation` | 一次生成任务及其输入、状态和结果，用于恢复与追溯 |
| `WorkflowRun` | 一次前端制作流程的运行记录，连接生成、确认、回退与导出 |

产品提供两种入口：`Quick Start` 用自然语言建立标准生产流程；`Workflow Editor` 用画布编排节点、处理并行动作和局部返工。两者共用同一套流程状态和质量门禁，不是两套独立产品。

## 当前阶段

> [!IMPORTANT]
> `main` 当前是 MS2 工程基线，不是已完成前后端联调的正式产品。

| 状态 | 内容 |
| --- | --- |
| 已进入 `main` | 前端模块骨架、领域对象与 API 契约；后端分层骨架与 `project` / `character` / `generation` / `media` 边界；前后端 CI 门禁 |
| 正在开发 | Quick Start 纵向流程、WorkflowRun 编排与恢复、产物审核和节点回退、独立 Playtest |
| 尚未完整交付 | 真实生成链路的端到端联调、完整的质检与导出流程、Cocos 可直接导入的资产包 |

当前进度以 [`main`](https://github.com/1024XEngineer/Windup/tree/main) 的已合并代码为准。Preview、候选 PR 和 Live Demo 只证明对应的交互或技术验证，不等同于完整产品已交付。

## 技术栈

- 前端：React 19、TypeScript 6、Vite 8、Tailwind CSS 4、Vitest
- 后端：Python 3.12、FastAPI、Pydantic、SQLAlchemy、uv workspace
- 工程约束：GitHub Actions、Ruff、Pytest、Import Linter、oxlint、oxfmt

## 本地开发

前端使用 Node.js 24：

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

## 质量检查

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

## 仓库结构

```text
Windup/
├── frontend/                  # React 前端、页面与制作流程
├── backend/                   # Python 工作区、领域服务与 API
├── docs/                      # 后端模块划分等工程文档
├── frontend-architecture-v3.md
└── README.md
```

## 相关文档

- [Windup 产品策划案](https://github.com/1024XEngineer/Windup/issues/37)
- [核心流程与工作流](https://github.com/1024XEngineer/Windup/issues/25)
- [前端架构与模块边界](frontend-architecture-v3.md)
- [前后端 API 契约差异](frontend/API_CONTRACT.md)
- [后端模块划分](docs/module-split.md)

## 参与贡献

功能和核心改动按 `Proposal → Issue → Branch → Pull Request → Review` 推进。开发前请先查看对应 Issue 与领域契约，不要把 Mock 成功、页面预览或未合并 PR 当作主分支交付。

## License

[Apache License 2.0](LICENSE)
