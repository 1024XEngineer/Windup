# Quick Start Capability Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Quick Start a real Project identity, align AI/manual runs on one pipeline, and introduce an injectable image-generation capability with a production Mock guard.

**Architecture:** A Quick Start feature use case composes the existing Project and WorkflowRun public APIs through an injected Project Planner. Generation gains a business-level Port and service factory without guessing an HTTP endpoint. Production safety is enforced at the capability service boundary and by architecture tests.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, Testing Library, Vite 8.

## Global Constraints

- Quick Start and manual workflow use one WorkflowRun model and one node sequence.
- Quick Start automation completes hidden nodes; it does not remove or skip them.
- `WorkflowRun.projectId` must always be a Project API result, never a sentinel.
- Do not invent Generation URLs, DTO envelopes, Task fields, or SSE events.
- Production runtime must reject Mock capability adapters.
- Preserve the user-owned untracked `docs/frontend-backend-misalignment.md` file.
- Do not add additional authorship or co-author trailers to commits.

---

### Task 1: Quick Start Project Planner and Start Use Case

**Files:**
- Create: `frontend/src/features/quick-start/model/project-planner.ts`
- Create: `frontend/src/features/quick-start/start-quick-start.ts`
- Create: `frontend/src/features/quick-start/start-quick-start.test.ts`
- Create: `frontend/src/features/quick-start/index.ts`

**Interfaces:**
- Consumes: `createProject(input): Promise<Project>` and `createWorkflowRun(input): Promise<WorkflowRun>` from `@/entities`.
- Produces: `startQuickStart(input): Promise<{ project: Project; run: WorkflowRun }>`.

- [ ] **Step 1: Write failing tests**

Add tests proving that the use case creates Project before WorkflowRun, passes the returned Project ID into
WorkflowRun creation, and does not create a run when Project creation rejects. Add a pure planner test with a
hand-checked 20-character-or-shorter name and the MS2 defaults `side`, `four-way`, and `64×64`.

- [ ] **Step 2: Verify the tests fail for missing feature code**

Run: `npm test -- src/features/quick-start/start-quick-start.test.ts`

Expected: FAIL because the new feature exports do not exist.

- [ ] **Step 3: Implement the minimal planner and use case**

Use dependency injection:

```ts
export interface QuickStartDependencies {
  createProject: (input: CreateProjectInput) => Promise<Project>
  createWorkflowRun: (input: CreateWorkflowRunInput) => Promise<WorkflowRun>
  planProject: (input: QuickStartInput) => Promise<CreateProjectInput>
}

export function createQuickStartStarter(dependencies: QuickStartDependencies) {
  return async (input: QuickStartInput): Promise<QuickStartStartResult> => {
    const project = await dependencies.createProject(await dependencies.planProject(input))
    const run = await dependencies.createWorkflowRun({
      projectId: project.id,
      driver: 'ai',
      prompt: input.prompt,
    })
    return { project, run }
  }
}
```

The default exported `startQuickStart` composes existing Entity functions and the MS2 planner.

- [ ] **Step 4: Verify focused tests pass**

Run: `npm test -- src/features/quick-start/start-quick-start.test.ts`

Expected: all focused tests pass without warnings.

### Task 2: One Initial Pipeline for AI and Manual Runs

**Files:**
- Modify: `frontend/src/entities/workflow-run/local/machine.ts`
- Modify: `tests/integration/workflow-run-store.test.ts`
- Modify: `frontend/src/app/quick-start-flow.test.tsx`
- Modify: `frontend/src/pages/quick-start/index.tsx`

**Interfaces:**
- Consumes: `startQuickStart(input)` from Task 1.
- Produces: both drivers start with active `asset` and `generationStatus: 'not_started'`.

- [ ] **Step 1: Write failing behavior tests**

Change the workflow integration expectation so an AI run starts on the asset node with `not_started`. Change the
page-flow test to expect “正在理解你的设定” and verify the persisted run's `projectId` is not `quick-start`.

- [ ] **Step 2: Verify expected failures**

Run: `npm test -- ../tests/integration/workflow-run-store.test.ts src/app/quick-start-flow.test.tsx`

Expected: FAIL because the current machine skips asset for AI and the page directly creates a sentinel run.

- [ ] **Step 3: Implement the shared initial pipeline**

Make `initialRevision` create one active asset node for both drivers and set `not_started`. Replace the page's direct
`createWorkflowRun` call with `startQuickStart`, then navigate using `result.run.id`.

- [ ] **Step 4: Verify focused tests pass**

Run: `npm test -- ../tests/integration/workflow-run-store.test.ts src/app/quick-start-flow.test.tsx`

Expected: both test files pass.

### Task 3: Image Generation Capability Port

**Files:**
- Create: `frontend/src/entities/generation/model/types.ts`
- Create: `frontend/src/entities/generation/model/port.ts`
- Create: `frontend/src/entities/generation/service.ts`
- Create: `frontend/src/entities/generation/service.test.ts`
- Create: `frontend/src/entities/generation/index.ts`
- Modify: `frontend/src/entities/index.ts`

**Interfaces:**
- Produces: `ImageGenerationPort`, `GenerateImagesInput`, `GeneratedImage`, and `createImageGenerationService`.

- [ ] **Step 1: Write failing service tests**

Test that a development service returns the injected adapter's generated images and that a production service
throws immediately when given a `kind: 'mock'` adapter. The fake adapter lives in the test file and returns complete
`GeneratedImage` values.

- [ ] **Step 2: Verify the tests fail for missing service code**

Run: `npm test -- src/entities/generation/service.test.ts`

Expected: FAIL because the generation module does not exist.

- [ ] **Step 3: Implement the minimal capability service**

The Port uses Promise-based `generate`; the service captures one adapter and delegates. Construction checks runtime
and rejects Mock in production. Do not create an HTTP adapter.

- [ ] **Step 4: Verify focused tests pass**

Run: `npm test -- src/entities/generation/service.test.ts`

Expected: all focused tests pass.

### Task 4: Architecture Guard and Documentation

**Files:**
- Modify: `tests/integration/architecture.test.ts`
- Modify: `frontend/README.md`
- Modify: `frontend/MODULES.md`
- Modify: `frontend/API_CONTRACT.md`
- Modify: `frontend-architecture-v3.md`

**Interfaces:**
- Consumes: the Quick Start use case and generation capability boundaries from Tasks 1–3.
- Produces: an enforceable rule that production composition cannot import a Mock capability implementation.

- [ ] **Step 1: Add the failing architecture assertion**

Add a test that scans non-test production composition files and reports imports whose resolved path contains a
capability `mock` directory. Include a fixture assertion proving the checker detects a Mock import.

- [ ] **Step 2: Verify the architecture test fails before helper implementation**

Run: `npm test -- ../tests/integration/architecture.test.ts`

Expected: FAIL for the new fixture until the checker is implemented.

- [ ] **Step 3: Implement the checker and update documentation**

Document that orchestration is currently frontend-owned, Quick Start auto-creates Project, AI/manual share every
node, image generation uses a capability Port, and the full global transport migration remains post-demo work.

- [ ] **Step 4: Verify architecture and public-contract tests**

Run: `npm test -- ../tests/integration/architecture.test.ts src/entities/public-contracts.test.ts`

Expected: all focused tests pass.

### Task 5: Full Verification

**Files:**
- Review every changed file from Tasks 1–4.

- [ ] **Step 1: Run the complete frontend gate**

Run in `frontend/`:

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

- [ ] **Step 2: Inspect repository state and diff**

Run `git status --short`, `git diff --check`, and review `git diff`. Confirm the only untracked unrelated file remains
`docs/frontend-backend-misalignment.md` and it is untouched.

- [ ] **Step 3: Commit only after the user requests publication**

Do not include any co-author trailer. Do not stage the unrelated untracked document.
