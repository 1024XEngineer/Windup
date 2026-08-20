# Directional Workflow Stage 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改变工作流节点拓扑的前提下，让四向、八向项目在角色母版与动作首帧节点内按源方向独立生成、选择、恢复和重试，并让 Quick Start 与 Workflow Editor 共用同一份方向状态。

**Architecture:** 方向是节点内部子状态，不新增方向节点。前端从 Project.directionalMovement 推导真实源方向；每个 `WorkflowGenerationRef` 记录可选 `direction`，旧记录默认 east。Controller 以 `nodeId + role + direction` 隔离 GenerationTask，只有全部必需源方向完成并确认后节点才通过。Quick Start 与 Workflow Editor 都调用同一个 Controller，持久化到现有 WorkflowRun。

**Tech Stack:** TypeScript、React 19、Vite、Vitest、Testing Library、现有 REST/SSE Generation API。

**Spec:** `docs/superpowers/specs/2026-08-19-four-eight-direction-generation-design.md`

## Global Constraints

- 复用现有分支 `feat/directional-generation-backend`，不得创建新分支。
- 只向 `xyh202131/Windup` 推送，并以 `1024XEngineer/Windup:main` 为 PR base。
- 后端只修复 Worker 对既有 `direction` 字段的反序列化；不改 OpenAPI、导出、角色详情、发布门禁或 Playtest。
- 每个真实源方向固定生成 2 个候选；旧无方向记录按 east 读取。
- 所有测试先失败，再写最小实现；失败必须对应缺失的方向行为。
- Git author、committer、PR head owner 均为 `xyh202131`，不得出现 Codex。
- PR 描述与评审说明使用中文；PR 创建为 Ready for review，不自动合并。

### Task 1: 方向领域契约和 API 映射

**Files:**
- Create: `frontend/src/entities/character/directions.ts`
- Create: `frontend/src/entities/character/directions.test.ts`
- Modify: `frontend/src/entities/character/index.ts`
- Modify: `frontend/src/entities/character/index.test.ts`
- Modify: `frontend/src/entities/generation/index.ts`
- Modify: `frontend/src/entities/generation/api.ts`
- Modify: `frontend/src/entities/generation/api.test.ts`
- Modify: `frontend/src/entities/workflow-run/index.ts`
- Modify: `frontend/src/entities/workflow-run/api.ts`
- Modify: `frontend/src/entities/workflow-run/api.test.ts`
- Modify: `frontend/src/entities/index.ts`
- Modify: `backend/packages/app/src/windup_app/worker/handlers.py`
- Modify: `backend/tests/test_mq_worker.py`

1. 写测试：single/four/eight 推导正确源方向；west 侧逻辑方向映射到对应 source direction。
2. 运行方向测试并确认因缺少 helper/类型而失败。
3. 写测试：图片任务创建 payload 带 direction、每方向只接受 2 个候选、旧 east 数据仍可解析。
4. 运行 API 测试并确认失败原因是方向契约尚未实现。
5. 最小实现 `ActionDirection`、方向 helper、Generation input/result direction 以及 `WorkflowGenerationRef.direction?`。
6. 让 WorkflowRun 解析器接受方向选择映射并继续兼容旧单 URL 字段。
7. 修复 MQ Worker 从任务 payload 恢复 direction，并验证非 east 输入不会退化为 east。
8. 运行前端方向测试及 `uv run pytest tests/test_mq_worker.py -q`。

### Task 2: Controller 按方向隔离任务、恢复和重试

**Files:**
- Modify: `frontend/src/features/workflow-controller/controller.test.ts`
- Modify: `frontend/src/features/workflow-controller/controller.ts`
- Modify: `frontend/src/features/workflow-controller/README.md`

1. 写测试：角色母版四向分别创建 task，task 引用包含方向，未全部完成时节点不能进入 selecting。
2. 写测试：动作首帧按方向独立生成与确认，已完成方向不会被另一方向重试覆盖。
3. 写测试：刷新恢复会逐方向读取任务并恢复订阅，单方向失败只标记该方向并可单独重试。
4. 运行 controller 测试，确认新用例先失败。
5. 将 generation 缓存、订阅和待挂载键改为 `nodeId + role + direction`；新增按方向查询接口。
6. 实现方向批量提交、逐方向结果应用、选择映射持久化与全部方向完成门槛。
7. 运行：`npm test -- --run src/features/workflow-controller/controller.test.ts`。

### Task 3: Quick Start 完成所有必需方向

**Files:**
- Modify: `frontend/src/pages/quick-start/service.test.ts`
- Modify: `frontend/src/pages/quick-start/service.ts`
- Modify: `frontend/src/pages/quick-start/index.test.tsx`
- Modify: `frontend/src/pages/quick-start/index.tsx`

1. 写测试：服务读取项目 directionalMovement，并让角色母版、动作首帧生成覆盖全部源方向。
2. 写测试：Quick Start 自动选择每方向候选并持久化到同一 Character/Outfit；页面展示当前方向进度。
3. 写测试：恢复后仅继续未完成方向，已确认方向不重复提交。
4. 运行 Quick Start 测试并确认失败。
5. 最小实现方向会话状态、逐方向候选获取/确认和恢复流程。
6. 运行：`npm test -- --run src/pages/quick-start/service.test.ts src/pages/quick-start/index.test.tsx`。

### Task 4: Workflow Editor 方向选择与单方向重试

**Files:**
- Modify: `frontend/src/pages/workflow-editor/character-template-confirmation.ts`
- Modify: `frontend/src/pages/workflow-editor/runtime.test.ts`
- Modify: `frontend/src/pages/workflow-editor/runtime.ts`
- Modify: `frontend/src/pages/workflow-editor/index.test.tsx`
- Modify: `frontend/src/pages/workflow-editor/index.tsx`
- Modify: `frontend/src/pages/workflow-editor/use-workflow-editor-session.ts`
- Modify: `frontend/src/pages/workflow-editor/workflow-editor-view.tsx`
- Modify: `frontend/src/pages/workflow-editor/workflow-editor.css`
- Modify: `frontend/src/app/workflow-editor-route.test.tsx`

1. 写测试：运行时按方向恢复 candidate group，旧无方向引用落到 east。
2. 写测试：编辑器显示源方向切换与每方向 2 个候选；确认、失败和重试只影响当前方向。
3. 写测试：全部必需方向确认前不能推进下一节点。
4. 运行 Workflow Editor 测试并确认失败。
5. 最小实现方向 tabs、候选 group、方向状态提示、当前方向重试和确认。
6. 运行：`npm test -- --run src/pages/workflow-editor/runtime.test.ts src/pages/workflow-editor/index.test.tsx src/app/workflow-editor-route.test.tsx`。

### Task 5: 范围清理、全量验证和 PR

1. 检查 diff，确保后端仅含 Worker direction 修复及其测试，且没有 OpenAPI、export、character-detail、publish-gate、playtest 文件。
2. 运行：`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`（目录 `frontend`）。
3. 运行 `git diff --check`，检查提交作者、提交者和 message，不得出现 Codex。
4. 提交到已有分支，推送到 `xyh202131/Windup`；推送前再次核对 remote 和 head owner。
5. 创建中文 Ready for review PR，base 为 `1024XEngineer/Windup:main`，说明依赖 #449 且明确不包含后续阶段。
6. 读取 PR 元数据，确认 head owner=`xyh202131`、base=`main`、状态 Ready、未合并。
