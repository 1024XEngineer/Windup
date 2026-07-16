# Windup

Windup 是一套面向 2D 游戏角色的可追溯资产生产工作流，目标是将角色母版、动作生成、分帧、质检、人工确认、资产入库和引擎预览连成一条可复用的交付链路。

> 本仓库是 `1024XEngineer/Windup` 的个人 Fork。所有开发必须先在 Fork 的独立分支完成，需要团队 Review 时再从 Fork 分支向上游发起 PR。

## Repository relationship

| Repository | Role |
|---|---|
| [`1024XEngineer/Windup`](https://github.com/1024XEngineer/Windup) | 团队上游主仓库 |
| [`huyanxius/game-asset-character`](https://github.com/huyanxius/game-asset-character) | 当前个人 Fork，用于分支开发和 Review |
| [`huyanxius/windup-asset-lab`](https://github.com/huyanxius/windup-asset-lab) | 当前可运行的角色资产工作台原型 |
| [`johnnyzhang-eng/windup-pipeline`](https://github.com/johnnyzhang-eng/windup-pipeline) | 队友的角色生成与处理管线 |

原型仓库和上游主仓库目前不共享 Git 历史。在团队确认正式目录结构前，不将原型仓库整仓强行推入本 Fork。

## Current work

当前功能分支：

```text
feature/canvas-workbench-workflow-reuse
```

该分支用于整理和 Review 以下能力：

- 参照 ComfyUI 但降低使用复杂度的自由节点画布。
- 角色来源 → 母版候选 → Walk / Idle 首帧 → 完整动画 → 资产入库。
- 未确认连接使用虚线，点击目标卡片后动画转为实线。
- 普通流程保留人工确认；已验证流程可保存为模板并用于新角色自动生成。
- 任何自动流程都必须在正式资产采用前停下，不得未经确认覆盖正式资产。

详细边界见 [`docs/proposals/canvas-workbench-workflow-reuse.md`](docs/proposals/canvas-workbench-workflow-reuse.md)。

## Fork development workflow

```bash
git clone https://github.com/huyanxius/game-asset-character.git
cd game-asset-character
git remote add upstream https://github.com/1024XEngineer/Windup.git

git fetch upstream
git switch main
git rebase upstream/main
git push origin main

git switch -c feature/<scope>
# implement, verify, commit
git push -u origin feature/<scope>
```

需要团队 Review 时，再从 `huyanxius:<branch>` 向 `1024XEngineer/Windup:main` 发起 PR。未经确认不直接在上游仓库创建开发分支。

## Review checklist

- 变更范围单一，不夹带无关资产和凭据。
- 候选资产和正式资产保持隔离。
- 流程复用创建新任务，不复用旧候选结果。
- 所有自动生成最终仍需显式采用。
- README、架构文档、验证命令与代码事实同步。
