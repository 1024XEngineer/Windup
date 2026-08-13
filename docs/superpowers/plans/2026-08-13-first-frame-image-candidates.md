# First-frame Image Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the action first-frame node generate three image candidates from the confirmed character template and action prompt, then let the user select one before complete animation generation.

**Architecture:** Keep the existing six-node WorkflowRun graph unchanged. Map both `character_template` and `first_frame` to the backend `character_image` task, while `complete_animation` remains a `character_action` task. The controller owns workflow transitions; Quick Start and Workflow Editor only present the three candidates and confirm the selected URL.

**Tech Stack:** React 19, TypeScript 6, Vitest, existing Generation HTTP/SSE adapter.

**Spec:** User-approved flow: `角色设定 -> 角色母版 -> 动作首帧三选一 -> 资产生成方式 -> 完整动画 -> 审核`.

## Global Constraints

- Do not change backend code or add a new architecture layer.
- Keep the six WorkflowRun node types and their dependency edges unchanged.
- First-frame generation uses one `/generation/image` task with `num_images: 3`.
- Complete animation generation continues to use `/generation/action` with 32 frames.
- Use the confirmed character template URL as the sole first-frame reference image.
- Use the project sprite width and height required by the backend image endpoint.

---

### Task 1: Generation contract and network adapter

**Files:**

- Modify: `frontend/src/entities/generation/index.ts`
- Modify: `frontend/src/entities/generation/api.ts`
- Test: `frontend/src/entities/generation/api.test.ts`

**Interfaces:**

- Consumes: confirmed template URL, action prompt, project sprite dimensions.
- Produces: `FirstFrameGenerationResult { type: 'first_frame'; images: readonly GeneratedImage[] }`.

- [x] Replace the existing first-frame adapter test with a test expecting `/generation/image`, `num_images: 3`, the template URL, prompt, width and height.
- [x] Run the targeted test and confirm it fails because main still calls `/generation/action`.
- [x] Change first-frame input/result contracts and map image results according to the supplied frontend expectation.
- [x] Keep complete animation result validation and `/generation/action` request behavior unchanged.
- [x] Add GET/SSE coverage proving an expected `first_frame` image task is restored as three candidates.
- [x] Run `npm test -- src/entities/generation/api.test.ts` and confirm it passes.

### Task 2: WorkflowController first-frame command

**Files:**

- Modify: `frontend/src/features/workflow-controller/controller.ts`
- Test: `frontend/src/features/workflow-controller/controller.test.ts`

**Interfaces:**

- Consumes: node ID plus project sprite width and height.
- Produces: one `first_frame` Generation referencing the confirmed character template.

- [x] Add a failing controller test asserting the input contains the confirmed template, action prompt and project dimensions, without video-only fields.
- [x] Run the targeted test and confirm the old input shape fails it.
- [x] Introduce a focused first-frame options type and build the image-generation input from the node dependency.
- [x] Update completed-result validation to accept exactly three first-frame candidate images.
- [x] Run `npm test -- src/features/workflow-controller/controller.test.ts` and confirm it passes.

### Task 3: Quick Start three-candidate flow

**Files:**

- Modify: `frontend/src/pages/quick-start/service.ts`
- Modify: `frontend/src/pages/quick-start/service.test.ts`
- Modify only if required: `frontend/src/pages/quick-start/index.test.tsx`

**Interfaces:**

- Consumes: Project sprite size and `FirstFrameGenerationResult.images`.
- Produces: three `QuickStartFrame` candidates and confirmation of one selected URL.

- [x] Add failing service tests for forwarding project dimensions and returning all three first-frame candidates.
- [x] Run the targeted service tests and verify the failures.
- [x] Carry or resolve project sprite size when opening/starting Quick Start sessions.
- [x] Map all first-frame result images to the existing candidate selector.
- [x] Run Quick Start service and page tests.

### Task 4: Workflow Editor three-candidate flow

**Files:**

- Modify: `frontend/src/pages/workflow-editor/index.tsx`
- Test: `frontend/src/pages/workflow-editor/index.test.tsx`

**Interfaces:**

- Consumes: `WorkflowEditorSession.project.spriteSize` and three generated images.
- Produces: three selectable candidate buttons and one confirmed `selectedFirstFrameUrl`.

- [x] Add a failing page test asserting that all three first-frame candidates render and one can be confirmed.
- [x] Run the targeted test and verify it fails with the current single-image rendering.
- [x] Pass project dimensions to the controller and render the result image array using the existing candidate-card pattern.
- [x] Run Workflow Editor page tests.

### Task 5: Full verification

**Files:**

- Review all changed files only; do not perform unrelated formatting or refactors.

- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint -- --deny-warnings`.
- [x] Run the formatter on the changed files; the repository-wide check still reports the pre-existing main baseline.
- [x] Run `npm run build`.
- [x] Inspect `git diff --check` and the final diff for scope, naming and six-node graph preservation.
