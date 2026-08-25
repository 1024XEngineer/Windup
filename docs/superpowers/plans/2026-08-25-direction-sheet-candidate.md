# Direction Sheet Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将四向/八向动作首帧候选从逐方向选择改为选择一张 3×3 方向候选卡，并在确认后直接进入完整动作生成。

**Architecture:** 保留后端和工作流控制器现有的逐源方向 URL 合同。Quick Start 增加纯函数，把同一候选序号的源方向结果组织成方向卡；UI 用 3×3 网格渲染真实 URL，镜像方向只做预览变换，确认时仍提交源方向 URL 映射。单向继续使用现有单图选择路径。

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Tailwind utility classes.

**Spec:** `docs/superpowers/specs/2026-08-25-direction-sheet-candidate.md`

## Global Constraints

- 不新增后端接口、数据库字段或媒体上传；只使用现有真实候选 URL。
- 不改变 `WorkflowController.confirmFirstFrame`、恢复、重试和导出合同。
- 四向和八向都使用 3×3 网格；四向斜向位置保持空白。
- 继续使用现有分支，不创建新分支；提交和 PR 只包含本功能相关文件。

### Task 1: 方向候选卡纯函数

**Files:**
- Create: `frontend/src/pages/quick-start/direction-sheet.ts`
- Test: `frontend/src/pages/quick-start/direction-sheet.test.ts`

**Interfaces:**
- `buildDirectionSheetCandidates(candidates, movement)` 返回按 `index` 分组的只读候选卡；每张卡保留 `selections`（源方向 URL）和 `cells`（逻辑方向预览单元）。
- `DirectionSheetCell` 包含 `direction`, `imageUrl`, `sourceDirection`, `mirrorX`, `empty`。

- [ ] **Step 1: Write the failing test**
  - 覆盖八向生成 5 个源方向时按候选序号生成卡片，并将镜像方向映射到同一源 URL。
  - 覆盖四向只填东/北/南/西（西由东镜像），四个斜向单元为 `empty`。
  - 覆盖源方向候选数量不一致时只返回完整卡片，不把缺失 URL 当成已选。
- [ ] **Step 2: Run test to verify it fails**
  - Run `npm --prefix frontend run test -- src/pages/quick-start/direction-sheet.test.ts --run`
  - Expected: FAIL because the module and builder do not exist.
- [ ] **Step 3: Write minimal implementation**
  - 按 `getDirectionProfile(movement).sourceDirections` 构造源方向索引；按候选 `index` 对齐；用 `resolveActionDirection` 生成镜像标记；只产出所有源方向都有 URL 的卡片。
- [ ] **Step 4: Run test to verify it passes**
  - 重跑同一 Vitest 命令，Expected: PASS。
- [ ] **Step 5: Commit**
  - `git add frontend/src/pages/quick-start/direction-sheet.ts frontend/src/pages/quick-start/direction-sheet.test.ts`
  - `git commit -m "feat: add direction sheet candidate model"`。

### Task 2: Quick Start 单卡选择与确认映射

**Files:**
- Modify: `frontend/src/pages/quick-start/index.tsx`
- Test: `frontend/src/pages/quick-start/index.test.tsx`

**Interfaces:**
- 新组件 `DirectionSheetCandidatePicker` 接收 `sheets`, `selectedIndex`, `disabled`, `kind`, `onSelect`。
- 选中卡片时以 `sheet.selections` 更新现有 `selectedFirstFrames`，不引入新的服务接口。

- [ ] **Step 1: Write the failing test**
  - 渲染四向候选时断言只出现一个可选的方向候选卡，斜向格存在但为空。
  - 点击卡片后断言 `confirmFirstFrame` 收到同一候选序号下的东/北/南源 URL 映射，而不是要求用户逐方向点击。
  - 断言确认按钮文案为“确认候选帧，生成完整动作”，并保持确认后自动推进。
- [ ] **Step 2: Run test to verify it fails**
  - Run `npm --prefix frontend run test -- src/pages/quick-start/index.test.tsx --run`
  - Expected: FAIL because the old picker still renders per-direction groups and requires individual selections.
- [ ] **Step 3: Write minimal implementation**
  - 引入 `buildDirectionSheetCandidates`；多源方向时渲染 3×3 卡片，镜像单元使用水平翻转样式，空单元不渲染图片但保留布局。
  - 选卡后把 `sheet.selections` 写入现有 state；单向继续渲染 `DirectionCandidatePicker`。
  - 已确认状态渲染同一方向卡，避免只显示 east URL。
  - 更新提示文案，明确“选择一套方向首帧，随后生成完整动作”。
- [ ] **Step 4: Run test to verify it passes**
  - 重跑同一 Vitest 命令，Expected: PASS。
- [ ] **Step 5: Commit**
  - `git add frontend/src/pages/quick-start/index.tsx frontend/src/pages/quick-start/index.test.tsx`
  - `git commit -m "feat: select directional first frames as one sheet"`

### Task 3: 定向验证与交付

**Files:**
- Modify only files from Tasks 1–2 unless a test fixture requires a directly related change.

- [ ] **Step 1: Run focused tests**
  - `npm --prefix frontend run test -- src/pages/quick-start/direction-sheet.test.ts src/pages/quick-start/index.test.tsx --run`
- [ ] **Step 2: Run type and whitespace checks**
  - `npm --prefix frontend run typecheck`
  - `git diff --check`
- [ ] **Step 3: Review the diff**
  - Confirm no backend, generated archive, document, or unrelated workflow files are staged.
- [ ] **Step 4: Push only to contributor fork**
  - Push existing branch `feat/full-direction-ui` to `xyh202131/Windup`; never push upstream directly.
- [ ] **Step 5: Open/update PR**
  - PR 描述使用中文，关联现有方向工作流 issue；若没有可复用 issue，先创建一个仅描述本功能的 issue，再在 PR 中引用。
