# Frontend Workflow Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WorkflowRun an explicitly frontend-owned orchestration model while preserving its public API and preparing separate backend capability adapters without inventing unfrozen endpoints.

**Architecture:** Pages keep calling the existing WorkflowRun entity facade. The facade delegates to a `WorkflowRunRepository` port backed by a localStorage adapter and a frontend-only MS2 state transition module; `shared/api` no longer registers or sends `/workflows/*`. Backend Task data is separated from the frontend mapping that associates a task with a run, revision, and node.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, browser localStorage, Oxlint, Oxfmt.

## Global Constraints

- PR #62 `docs/architecture.md` is the backend architecture source of truth.
- Keep `createWorkflowRun`, `fetchWorkflowRun`, and `submitWorkflowCommand` signatures unchanged.
- Do not add guessed Generation, Asset, Review, Playtest, Export URLs or DTOs.
- Do not change routes, page layouts, or user-visible workflow behavior.
- Production code must not send `/workflows` or `/workflow-runs` requests.
- Mock generation, quality, review, or export state must not be documented as a real backend capability.
- Preserve existing unrelated untracked files, especially `docs/frontend-backend-misalignment.md`.

---

## File Structure

- Create `frontend/src/entities/workflow-run/model/repository.ts`: repository port used by orchestration functions.
- Create `frontend/src/entities/workflow-run/local/store.ts`: localStorage and memory fallback for domain `WorkflowRun` objects.
- Create `frontend/src/entities/workflow-run/local/machine.ts`: frontend-only MS2 command transitions using camelCase domain types.
- Create `frontend/src/entities/workflow-run/local/repository.ts`: local adapter implementing the repository port.
- Create `frontend/src/entities/workflow-run/orchestration/create-workflow-run.ts`: stable async public facade.
- Create `frontend/src/entities/workflow-run/orchestration/get-workflow-run.ts`: stable async public facade.
- Create `frontend/src/entities/workflow-run/orchestration/submit-workflow-command.ts`: stable async public facade.
- Modify `frontend/src/entities/workflow-run/index.ts`: export orchestration functions and new task-link type.
- Delete `frontend/src/entities/workflow-run/api/*`: remove fake HTTP DTO and requests.
- Delete `frontend/src/shared/api/client/mock/workflow-run/*`: remove the fake backend resource.
- Modify `frontend/src/shared/api/client/mock/index.ts`: keep only backend-capability mocks such as Project.
- Modify `frontend/src/entities/workflow-run/model/task.ts`: separate backend Task from frontend WorkflowTaskLink.
- Modify `frontend/src/entities/public-contracts.test.ts`: compile-time contract assertions.
- Modify `tests/integration/architecture.test.ts`: enforce the no-WorkflowRun-HTTP boundary.
- Modify `tests/integration/workflow-run-store.test.ts`: retain behavior coverage and add storage-shape coverage.
- Modify `frontend/API_CONTRACT.md`, `frontend/MODULES.md`, `frontend/README.md`, and `frontend-architecture-v3.md`: align documentation with PR #62.

---

### Task 1: Decouple backend Task from frontend workflow correlation

**Files:**
- Modify: `frontend/src/entities/public-contracts.test.ts`
- Modify: `frontend/src/entities/workflow-run/model/task.ts`
- Modify: `frontend/src/entities/workflow-run/index.ts`
- Modify: `frontend/src/entities/index.ts`

**Interfaces:**
- Consumes: `WorkflowRun['id']`, `WorkflowRevision['id']`, `WorkflowNode['id']`.
- Produces: `Task`, `TaskEvent`, and `WorkflowTaskLink` exported from `@/entities`.

- [ ] **Step 1: Write the failing type test**

Replace the Task assertions in `public-contracts.test.ts` with:

```ts
import type { WorkflowTaskLink } from './index'

expectTypeOf<Task>().not.toHaveProperty('runId')
expectTypeOf<Task>().not.toHaveProperty('revisionId')
expectTypeOf<WorkflowTaskLink>().toEqualTypeOf<{
  taskId: string
  runId: string
  revisionId: string
  nodeId: string
}>()
```

- [ ] **Step 2: Run the type test to verify RED**

Run: `npm test -- src/entities/public-contracts.test.ts`

Expected: FAIL because `Task` still has `runId/revisionId` and `WorkflowTaskLink` is not exported.

- [ ] **Step 3: Implement the minimal contracts**

Change `model/task.ts` to:

```ts
import type { WorkflowNode, WorkflowRevision, WorkflowRun } from './types'

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface Task {
  id: string
  status: TaskStatus
  progress: number | null
  error: string | null
  result: unknown
}

export interface TaskEvent extends Omit<Task, 'id'> {
  taskId: Task['id']
}

export interface WorkflowTaskLink {
  taskId: Task['id']
  runId: WorkflowRun['id']
  revisionId: WorkflowRevision['id']
  nodeId: WorkflowNode['id']
}
```

Export `WorkflowTaskLink` through both WorkflowRun and aggregate Entity public indexes.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `npm test -- src/entities/public-contracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the task**

```text
git add frontend/src/entities/public-contracts.test.ts frontend/src/entities/workflow-run/model/task.ts frontend/src/entities/workflow-run/index.ts frontend/src/entities/index.ts
git commit -m "refactor(frontend): decouple tasks from workflow runs"
```

---

### Task 2: Replace fake WorkflowRun HTTP routes with a local repository adapter

**Files:**
- Modify: `tests/integration/architecture.test.ts`
- Modify: `tests/integration/workflow-run-store.test.ts`
- Create: `frontend/src/entities/workflow-run/model/repository.ts`
- Create: `frontend/src/entities/workflow-run/local/store.ts`
- Create: `frontend/src/entities/workflow-run/local/machine.ts`
- Create: `frontend/src/entities/workflow-run/local/repository.ts`
- Create: `frontend/src/entities/workflow-run/orchestration/create-workflow-run.ts`
- Create: `frontend/src/entities/workflow-run/orchestration/get-workflow-run.ts`
- Create: `frontend/src/entities/workflow-run/orchestration/submit-workflow-command.ts`
- Modify: `frontend/src/entities/workflow-run/index.ts`
- Modify: `frontend/src/shared/api/client/mock/index.ts`
- Delete: `frontend/src/entities/workflow-run/api/create-workflow-run.ts`
- Delete: `frontend/src/entities/workflow-run/api/get-workflow-run.ts`
- Delete: `frontend/src/entities/workflow-run/api/submit-workflow-command.ts`
- Delete: `frontend/src/entities/workflow-run/api/dto.ts`
- Delete: `frontend/src/shared/api/client/mock/workflow-run/index.ts`
- Delete: `frontend/src/shared/api/client/mock/workflow-run/machine.ts`
- Delete: `frontend/src/shared/api/client/mock/workflow-run/store.ts`
- Delete: `frontend/src/shared/api/client/mock/workflow-run/types.ts`

**Interfaces:**
- Consumes: `CreateWorkflowRunInput`, `WorkflowCommand`, and `WorkflowRun` domain types.
- Produces: the unchanged async facade signatures and a local `WorkflowRunRepository` implementation.

- [ ] **Step 1: Write the failing architecture boundary test**

Add to `tests/integration/architecture.test.ts`:

```ts
it('WorkflowRun 是前端编排模型，不通过 HTTP transport', () => {
  const workflowRoot = join(SRC, 'entities/workflow-run')
  const offenders: string[] = []

  for (const file of walk(workflowRoot)) {
    if (/\.test\.tsx?$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    const rel = relativeSrc(file)
    if (moduleSpecifiers(file, source).includes('@/shared/api')) {
      offenders.push(`${rel}: imports @/shared/api`)
    }
    if (/['"`]\/workflow-runs?(?:\/|['"`])/.test(source)) {
      offenders.push(`${rel}: runtime workflow HTTP path`)
    }
  }

  const mockWorkflowDir = join(SRC, 'shared/api/client/mock/workflow-run')
  if (existsSync(mockWorkflowDir)) offenders.push('shared/api/client/mock/workflow-run exists')

  expect(offenders).toEqual([])
})
```

Add this assertion to the persistence test after creating a run:

```ts
const stored = JSON.parse(localStorage.getItem('windup.workflow-runs.v1') ?? '{}')
expect(stored[created.id]).toEqual(created)
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `npm test -- ../tests/integration/architecture.test.ts ../tests/integration/workflow-run-store.test.ts`

Expected: FAIL listing the three `@/shared/api` imports, runtime `/workflows` paths, existing mock directory, and missing new storage key.

- [ ] **Step 3: Define the repository port**

Create `model/repository.ts`:

```ts
import type { CreateWorkflowRunInput, WorkflowCommand, WorkflowRun } from './types'

export interface WorkflowRunRepository {
  create(input: CreateWorkflowRunInput): WorkflowRun
  get(runId: WorkflowRun['id']): WorkflowRun | null
  submit(runId: WorkflowRun['id'], command: WorkflowCommand): WorkflowRun
}
```

- [ ] **Step 4: Implement domain-shaped local storage**

Create `local/store.ts` using storage key `windup.workflow-runs.v1`. Save and load `WorkflowRun`
objects directly, validate that every record has a string `id` and a `revisions` array, and fall back to a
module-level map when localStorage throws. Keep ID generation as:

```ts
export function newId(prefix: 'run' | 'revision' | 'node'): string {
  return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`
}
```

The exact exported storage operations are:

```ts
export function saveRun(run: WorkflowRun): WorkflowRun
export function loadRun(runId: WorkflowRun['id']): WorkflowRun | null
```

- [ ] **Step 5: Convert the MS2 state machine to domain types**

Move the existing transition algorithm to `local/machine.ts` and apply these exact field conversions:

```text
current_revision_id      -> currentRevisionId
based_on_revision_id     -> basedOnRevisionId
restart_node_id          -> restartNodeId
generation_status        -> generationStatus
export_status            -> exportStatus
playtest_status          -> playtestStatus
reference_node_ids       -> referenceNodeIds
quality_failure_count    -> qualityFailureCount
node_id                  -> nodeId
source_revision_id       -> sourceRevisionId
revision_id              -> revisionId
```

Use `WORKFLOW_NODE_ORDER` from `model/types.ts` instead of defining a DTO order. Export:

```ts
export function createLocalRun(input: CreateWorkflowRunInput): WorkflowRun
export function advanceLocalRun(runId: WorkflowRun['id'], command: WorkflowCommand): WorkflowRun
```

The initial AI revision contains passed `asset` and active `generation` nodes; the manual revision contains
an active `asset` node. Keep all existing quality failure, restart, Playtest, and export transition behavior.

- [ ] **Step 6: Implement the local adapter and async facade**

Create `local/repository.ts`:

```ts
import type { WorkflowRunRepository } from '../model/repository'
import { advanceLocalRun, createLocalRun } from './machine'
import { loadRun } from './store'

export const localWorkflowRunRepository: WorkflowRunRepository = {
  create: createLocalRun,
  get: loadRun,
  submit: advanceLocalRun,
}
```

Create the three orchestration files with the stable signatures. Each delegates to
`localWorkflowRunRepository`; `fetchWorkflowRun` throws `工作流 ${runId} 不存在` when `get` returns null.
No orchestration file imports `@/shared/api`.

- [ ] **Step 7: Remove fake HTTP wiring**

Update `workflow-run/index.ts` to export from `./orchestration/*`. Remove
`workflowRunMockHandlers` from the route list in `shared/api/client/mock/index.ts`. Delete the old fake HTTP
API, DTO, and mock WorkflowRun directories listed above.

- [ ] **Step 8: Run focused tests to verify GREEN**

Run: `npm test -- ../tests/integration/architecture.test.ts ../tests/integration/workflow-run-store.test.ts src/app/quick-start-flow.test.tsx src/pages/workflow-editor/editor/index.test.tsx`

Expected: PASS with unchanged page behavior and no WorkflowRun HTTP boundary violations.

- [ ] **Step 9: Commit the task**

```text
git add frontend/src/entities/workflow-run frontend/src/shared/api/client/mock/index.ts tests/integration/architecture.test.ts tests/integration/workflow-run-store.test.ts
git commit -m "refactor(frontend): keep workflow orchestration local"
```

---

### Task 3: Align frontend documentation with PR #62

**Files:**
- Modify: `frontend/API_CONTRACT.md`
- Modify: `frontend/MODULES.md`
- Modify: `frontend/README.md`
- Modify: `frontend-architecture-v3.md`

**Interfaces:**
- Consumes: the implemented repository/orchestration boundary and Task/WorkflowTaskLink types.
- Produces: one consistent description of current frontend orchestration and future backend capability clients.

- [ ] **Step 1: Update API contract status**

Replace the `/workflows/*` pending-backend section with these facts:

```text
- WorkflowRun/Revision/node routes are not backend endpoints.
- Current MS2 orchestration is persisted by the frontend local repository.
- Real backend integration happens through independent Project, Media, Character, Generation, Asset,
  Review, Playtest, and Export contracts.
- Backend Task has no runId/revisionId; WorkflowTaskLink is frontend-only correlation data.
```

Keep all unfrozen capability endpoints explicitly marked unaligned.

- [ ] **Step 2: Update module and setup documentation**

In `MODULES.md`, assign WorkflowRun orchestration to the frontend Entity and describe future capability
Adapters as internal dependencies of the orchestrator. In `README.md`, state that WorkflowRun does not use
the global Mock/Real HTTP switch; capability APIs still do.

- [ ] **Step 3: Update the architecture document**

In `frontend-architecture-v3.md`:

```text
- Remove the claim that the backend will persist WorkflowRun.
- Remove “Python WorkflowRun API adapter” from pending work.
- State that backend workflow definition and execution are separate future domains.
- State that WorkflowTaskLink correlates backend task IDs to frontend run/revision/node IDs.
```

- [ ] **Step 4: Check for stale contract language**

Run:

```text
rg -n "/workflows|Python WorkflowRun|后端.*WorkflowRun|WorkflowRun.*后端" frontend frontend-architecture-v3.md
```

Expected: only explanatory statements saying that WorkflowRun is not a backend endpoint; no pending real
WorkflowRun adapter or route remains.

- [ ] **Step 5: Commit the task**

```text
git add frontend/API_CONTRACT.md frontend/MODULES.md frontend/README.md frontend-architecture-v3.md
git commit -m "docs(frontend): align orchestration with backend domains"
```

---

### Task 4: Full verification and final scope audit

**Files:**
- Verify only; modify implementation files only if a check exposes a defect.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: fresh evidence that the repository meets the design acceptance criteria.

- [ ] **Step 1: Format and verify formatting**

Run: `npm run format`

Run: `npm run format:check`

Expected: both exit 0.

- [ ] **Step 2: Run static and behavioral checks**

Run: `npm run lint`

Run: `npm run test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: every command exits 0 and all Vitest files pass.

- [ ] **Step 3: Verify the diff and forbidden paths**

Run:

```text
git diff --check
rg -n "request<.*WorkflowRun|/workflow-runs|/workflows" frontend/src
git status --short
```

Expected: no WorkflowRun HTTP request/path matches, no whitespace errors, and the pre-existing untracked
`docs/frontend-backend-misalignment.md` remains unmodified and unstaged.

- [ ] **Step 4: Review requirements line by line**

Confirm:

```text
[ ] WorkflowRun public signatures are unchanged.
[ ] shared/api has no WorkflowRun route.
[ ] local storage saves camelCase domain records.
[ ] Task and WorkflowTaskLink are separated.
[ ] no capability endpoint was guessed.
[ ] all four frontend documents agree with PR #62.
```

- [ ] **Step 5: Commit verification fixes only if needed**

If verification required code changes, stage only those exact files and commit:

```text
git commit -m "fix(frontend): complete orchestration boundary"
```
