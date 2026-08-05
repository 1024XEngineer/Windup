# Uploaded Character Template Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Quick Start and Workflow Editor upload a character image and proceed directly to 32-frame action generation, while preserving the existing text-only character-generation path.

**Architecture:** One shared `MediaApis` instance is composed in App. The workflow state machine gains an explicit uploaded-template transition; Quick Start owns the existing character creation/action orchestration, and Workflow Editor delegates to that same use case instead of duplicating it.

**Tech Stack:** React 19, TypeScript 6, Vitest, existing Workflow Controller and MediaApis.

## Global Constraints

- Uploaded image plus non-empty text generates a `custom` action using that text as the action prompt.
- Uploaded image plus blank text generates the default `idle` action.
- No uploaded image preserves the existing character-description, generated-candidate and confirmation flow.
- Uploaded images must never be represented as a successful backend image Generation task.
- Complete animation generation remains 32 frames.
- Add no dependency and no new business module.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Shared uploaded-template workflow transition and App composition

**Files:**
- Modify: `frontend/src/features/workflow-controller/workflow-state.test.ts`
- Modify: `frontend/src/features/workflow-controller/workflow-state.ts`
- Modify: `frontend/src/features/workflow-controller/controller.ts`
- Modify: `frontend/src/app/app.tsx`
- Test: `frontend/src/app/app-composition.test.tsx`

**Interfaces:**
- Produces: `WorkflowController.acceptUploadedCharacterTemplate(runId, templateUrl): WorkflowRun`.
- Produces: one `createMediaApis()` instance passed into Quick Start composition.

- [ ] **Step 1: Write the failing state test**

Assert that accepting `media-upload-1` on an initial create-character run yields statuses `passed, passed, passed, active, locked`, stores the reference on character setup, exposes it as the template/candidate output, keeps `generationStatus` as `not_started`, and leaves exactly one active step.

- [ ] **Step 2: Run the state test and verify RED**

Run: `npm.cmd test -- src/features/workflow-controller/workflow-state.test.ts`

Expected: FAIL because `acceptUploadedCharacterTemplateState` does not exist.

- [ ] **Step 3: Implement the pure transition and controller method**

Add the pure state function and save its result through the controller. Reject blank references, non-active runs, and any active step other than `character-setup`. Do not create a Generation input or task ID.

- [ ] **Step 4: Add shared App composition**

Create `const mediaApis = createMediaApis()` beside other entity adapters, pass it to Quick Start, and wire Workflow Editor's uploaded-template callback to the Quick Start service method defined in Task 2.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm.cmd test -- src/features/workflow-controller/workflow-state.test.ts src/app/app-composition.test.tsx`

Expected: PASS.

### Task 2: Quick Start upload button and direct-action use case

**Files:**
- Modify: `frontend/src/pages/quick-start/service.test.ts`
- Modify: `frontend/src/pages/quick-start/service.ts`
- Modify: `frontend/src/pages/quick-start/index.test.tsx`
- Modify: `frontend/src/pages/quick-start/index.tsx`

**Interfaces:**
- Consumes: `WorkflowController.acceptUploadedCharacterTemplate(runId, templateUrl)`.
- Produces: `QuickStartService.startWithUploadedTemplate(file, actionDescription, signal?)`.
- Produces: `QuickStartService.continueWithUploadedTemplate(runId, file, actionDescription, signal?)`, reused by Workflow Editor.

- [ ] **Step 1: Write failing service tests**

Cover non-empty text → `custom`, blank text → `idle`, `MediaApis.upload(file, 'reference-image', signal)`, no character-template Generation call, and upload failure before WorkflowRun creation/advance.

- [ ] **Step 2: Write failing page tests**

Assert an image button exists in the lower-right input actions, selecting an image allows blank-text submit, selected filename/removal are available, and removing the image restores the text-required rule.

- [ ] **Step 3: Run Quick Start tests and verify RED**

Run: `npm.cmd test -- src/pages/quick-start/service.test.ts src/pages/quick-start/index.test.tsx`

Expected: FAIL because the methods and upload UI do not exist.

- [ ] **Step 4: Implement the minimal service behavior**

Prepare a project using trimmed action text or the selected filename as the naming seed, upload through `MediaApis`, create the run only after upload succeeds, accept the uploaded template, then reuse the existing character creation/action-generation function. Existing `start(prompt)` stays unchanged.

- [ ] **Step 5: Implement the minimal UI**

Use one hidden `input[type=file][accept="image/*"]`, a visible lower-right button, filename/removal controls, conditional placeholder/help copy, submit guarding, and an AbortController for the in-flight upload.

- [ ] **Step 6: Run Quick Start tests and verify GREEN**

Run: `npm.cmd test -- src/pages/quick-start/service.test.ts src/pages/quick-start/index.test.tsx`

Expected: PASS.

### Task 3: Workflow Editor uploaded-template shortcut

**Files:**
- Modify: `frontend/src/pages/workflow-editor/service.ts`
- Modify: `frontend/src/pages/workflow-editor/index.test.tsx`
- Modify: `frontend/src/pages/workflow-editor/index.tsx`
- Modify: `frontend/src/pages/workflow-editor/workflow-canvas.tsx`
- Modify: `frontend/src/pages/workflow-editor/workflow-editor.css`

**Interfaces:**
- Consumes: injected `continueWithUploadedTemplate(runId, file, actionDescription, signal?)` callback.
- Produces: `WorkflowEditorService.continueWithUploadedTemplate(...)` for the page.

- [ ] **Step 1: Write failing page/service tests**

Assert the active character-setup node can return `{ description, file }`; with a file the page calls the uploaded-template service once and does not call `nextStep`, while without a file it keeps `updateCharacterSetup` plus `nextStep`.

- [ ] **Step 2: Run Workflow Editor tests and verify RED**

Run: `npm.cmd test -- src/pages/workflow-editor/index.test.tsx`

Expected: FAIL because the file control and service method do not exist.

- [ ] **Step 3: Implement event and service delegation**

Render the image input in the existing character-setup node. Extend delegated submit handling to pass the selected `File`. Route file submissions to the injected uploaded-template use case and text-only submissions to the unchanged path. Abort the upload when the run view unmounts.

- [ ] **Step 4: Run Workflow Editor tests and verify GREEN**

Run: `npm.cmd test -- src/pages/workflow-editor/index.test.tsx`

Expected: PASS.

### Task 4: Integration, regression and review

**Files:**
- Modify only files required by concrete failures from the commands below.

- [ ] **Step 1: Run the complete frontend suite**

Run: `npm.cmd test`

Expected: all tests pass.

- [ ] **Step 2: Run production checks**

Run: `npm.cmd run build`, `npm.cmd run lint`, `npm.cmd run format:check`, and repository `git diff --check`.

Expected: all commands pass.

- [ ] **Step 3: Review cross-entry consistency**

Verify both entries share the same `MediaApis`, controller transition and character/action orchestration; verify text-only flows and historical runs remain unchanged.

- [ ] **Step 4: Request final code review**

Review for workflow-state validity, duplicate submission, abort behavior, error recovery, and accidental fake Generation results. Resolve all Critical and Important findings before completion.
