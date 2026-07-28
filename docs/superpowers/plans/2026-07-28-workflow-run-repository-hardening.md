# WorkflowRun Repository Hardening Implementation Plan

> Historical note: the Quick Start initial-node rule was superseded by
> `2026-07-28-quick-start-capability-adapters.md`; the repository hardening tasks stay valid.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend-owned WorkflowRun repository network-shaped and replaceable while preventing local persistence loss, unsupported-ID crashes, incorrect initial generation state, and malformed hydration.

**Architecture:** Keep the existing Promise-based public facade and PR #62 frontend ownership. Introduce one composition entry that selects an asynchronous repository port, currently backed by the local state machine. Harden the local adapter with a memory-wins overlay, layered ID generation, and complete runtime validation without inventing a backend WorkflowRun route.

**Tech Stack:** React 19, TypeScript 6, Vitest 4, browser localStorage, Oxlint, Oxfmt.

## Global Constraints

- Keep `createWorkflowRun`, `fetchWorkflowRun`, and `submitWorkflowCommand` public signatures unchanged.
- Do not add `/workflows`, `/workflow-runs`, or guessed backend DTOs.
- PR #62 remains the backend boundary source of truth: WorkflowRun is frontend page orchestration.
- All repository operations return Promise values even when the current adapter is local.
- The three orchestration files select their implementation through exactly one composition entry.
- Current-session memory data overrides stale localStorage data after any failed persistence attempt.
- Manual creation starts with generation status `not_started`; Quick Start starts with `in_progress`.
- Malformed persisted records never enter the domain layer; valid siblings remain readable.
- Preserve the unrelated untracked `docs/frontend-backend-misalignment.md` file without editing or staging it.
- Follow TDD: add and observe each focused failure before editing production code.

---

## File Structure

- Create `frontend/src/entities/workflow-run/repository.ts`: the only runtime composition entry; exports `workflowRunRepository`.
- Modify `frontend/src/entities/workflow-run/model/repository.ts`: asynchronous repository port.
- Create `frontend/src/entities/workflow-run/model/repository.test.ts`: compile-time Promise contract test.
- Modify `frontend/src/entities/workflow-run/local/repository.ts`: asynchronous local adapter.
- Modify `frontend/src/entities/workflow-run/orchestration/*.ts`: depend on the composition entry.
- Modify `frontend/src/entities/workflow-run/local/store.ts`: memory overlay, persistence reads, and layered ID generation.
- Create `frontend/src/entities/workflow-run/local/validation.ts`: complete persisted WorkflowRun validation and per-record filtering.
- Modify `frontend/src/entities/workflow-run/local/machine.ts`: `not_started` lifecycle transitions.
- Modify `frontend/src/entities/workflow-run/model/types.ts`: add `GenerationStatus` member.
- Modify `tests/integration/architecture.test.ts`: enforce one repository binding point.
- Modify `tests/integration/workflow-run-store.test.ts`: behavioral regression coverage for all reported failures.
- Modify `frontend/API_CONTRACT.md`, `frontend/MODULES.md`, `frontend/README.md`, and `frontend-architecture-v3.md`: synchronize the implemented contract.

---

### Task 1: Async repository port and single composition entry

**Files:**
- Create: `frontend/src/entities/workflow-run/model/repository.test.ts`
- Create: `frontend/src/entities/workflow-run/repository.ts`
- Modify: `frontend/src/entities/workflow-run/model/repository.ts`
- Modify: `frontend/src/entities/workflow-run/local/repository.ts`
- Modify: `frontend/src/entities/workflow-run/orchestration/create-workflow-run.ts`
- Modify: `frontend/src/entities/workflow-run/orchestration/get-workflow-run.ts`
- Modify: `frontend/src/entities/workflow-run/orchestration/submit-workflow-command.ts`
- Modify: `tests/integration/architecture.test.ts`

**Interfaces:**
- Consumes: synchronous `createLocalRun`, `loadRun`, and `advanceLocalRun` functions.
- Produces: `WorkflowRunRepository` methods returning Promise values and `workflowRunRepository: WorkflowRunRepository` as the only selected implementation.

- [ ] **Step 1: Write failing Promise type tests**

Create `model/repository.test.ts`:

```ts
import { describe, expectTypeOf, it } from 'vitest'

import type { WorkflowRunRepository } from './repository'
import type { WorkflowRun } from './types'

describe('WorkflowRunRepository 契约', () => {
  it('所有操作都使用可等待的网络形状', () => {
    expectTypeOf<ReturnType<WorkflowRunRepository['create']>>().toEqualTypeOf<
      Promise<WorkflowRun>
    >()
    expectTypeOf<ReturnType<WorkflowRunRepository['get']>>().toEqualTypeOf<
      Promise<WorkflowRun | null>
    >()
    expectTypeOf<ReturnType<WorkflowRunRepository['submit']>>().toEqualTypeOf<
      Promise<WorkflowRun>
    >()
  })
})
```

- [ ] **Step 2: Extend the architecture test to reject direct local bindings**

Inside the existing WorkflowRun architecture test, inspect files below `orchestration/`. Add an offender when
an import resolves below `../local/`, and require `entities/workflow-run/repository.ts` to exist. The current
three direct imports must make the focused test fail.

- [ ] **Step 3: Run RED checks**

Run from `frontend/`:

```text
npm test -- src/entities/workflow-run/model/repository.test.ts ../tests/integration/architecture.test.ts
```

Expected: type assertions report synchronous return types, and the architecture test lists all three direct
`local/repository` imports.

- [ ] **Step 4: Implement the asynchronous port**

Change the port signatures to:

```ts
export interface WorkflowRunRepository {
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  get(runId: WorkflowRun['id']): Promise<WorkflowRun | null>
  submit(runId: WorkflowRun['id'], command: WorkflowCommand): Promise<WorkflowRun>
}
```

Wrap the synchronous local implementation at the adapter boundary:

```ts
export const localWorkflowRunRepository: WorkflowRunRepository = {
  async create(input) {
    return createLocalRun(input)
  },
  async get(runId) {
    return loadRun(runId)
  },
  async submit(runId, command) {
    return advanceLocalRun(runId, command)
  },
}
```

- [ ] **Step 5: Add and use the one composition entry**

Create `entities/workflow-run/repository.ts`:

```ts
import { localWorkflowRunRepository } from './local/repository'
import type { WorkflowRunRepository } from './model/repository'

/** 当前实现选择点；真实契约冻结后只在这里替换或组合 Adapter。 */
export const workflowRunRepository: WorkflowRunRepository = localWorkflowRunRepository
```

Import `workflowRunRepository` from `../repository` in all three orchestration files. Await `get` before its
null check; return the Promise directly for create and submit.

- [ ] **Step 6: Run GREEN checks**

Run:

```text
npm test -- src/entities/workflow-run/model/repository.test.ts ../tests/integration/architecture.test.ts ../tests/integration/workflow-run-store.test.ts
```

Expected: all selected test files pass.

- [ ] **Step 7: Commit Task 1**

Stage only the Task 1 files and commit:

```text
refactor(frontend): make workflow repository replaceable
```

---

### Task 2: Preserve latest session data when persistence fails

**Files:**
- Modify: `tests/integration/workflow-run-store.test.ts`
- Modify: `frontend/src/entities/workflow-run/local/store.ts`

**Interfaces:**
- Consumes: existing `saveRun` and `loadRun` calls from the local state machine.
- Produces: a memory overlay whose entries win over the persisted snapshot for the same run ID.

- [ ] **Step 1: Add a storage double that rejects writes**

Add a test helper which accepts an existing map, returns it from `getItem`, and throws `QuotaExceededError`
from `setItem`. It must implement the complete `Storage` shape and preserve the serialized old snapshot.

- [ ] **Step 2: Write the failing data-loss regression test**

The test performs these real facade operations:

1. Create an old run in writable storage and capture the serialized snapshot.
2. Replace `localStorage` with the write-rejecting storage containing only that old snapshot.
3. Create a new run; creation returns successfully because memory is the fallback.
4. Fetch the new run and assert its ID and revision ID match the just-created object.

The current implementation must fail at step 4 because it re-reads the old disk snapshot first.

- [ ] **Step 3: Run the focused test to verify RED**

Run:

```text
npm test -- ../tests/integration/workflow-run-store.test.ts -t "写入失败后仍读取本次会话的最新工作流"
```

Expected: FAIL with `工作流 <new-id> 不存在`.

- [ ] **Step 4: Implement memory-wins merge semantics**

Split disk parsing from the merged read:

```ts
function readPersisted(): RunMap {
  // Return only a parsed, validated disk map; return {} on absence or failure.
}

function readAll(): RunMap {
  return { ...readPersisted(), ...memory }
}

export function saveRun(run: WorkflowRun): WorkflowRun {
  memory = { ...memory, [run.id]: run }
  const snapshot = readAll()
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // The memory overlay remains authoritative for this session.
  }
  return run
}
```

Do not clear `memory` after a successful write; it remains the session's latest-authority overlay.

- [ ] **Step 5: Run RED test and the full store suite to verify GREEN**

Run:

```text
npm test -- ../tests/integration/workflow-run-store.test.ts
```

Expected: all WorkflowRun integration tests pass.

- [ ] **Step 6: Commit Task 2**

Stage the store and integration test, then commit:

```text
fix(frontend): preserve workflow memory fallback
```

---

### Task 3: Generate IDs without requiring randomUUID

**Files:**
- Modify: `tests/integration/workflow-run-store.test.ts`
- Modify: `frontend/src/entities/workflow-run/local/store.ts`

**Interfaces:**
- Consumes: ID prefixes `run`, `revision`, and `node`.
- Produces: `newId(prefix): string` that survives missing `randomUUID` and missing Web Crypto.

- [ ] **Step 1: Write two failing runtime tests**

Add one test with `crypto` stubbed to an object that exposes only `getRandomValues`; creating a run must return
IDs beginning with `run-`, `revision-`, and `node-`. Add another test with `crypto` set to `undefined`; create
two runs and assert both succeed and their run IDs differ.

- [ ] **Step 2: Run tests to verify RED**

Run:

```text
npm test -- ../tests/integration/workflow-run-store.test.ts -t "randomUUID|Web Crypto"
```

Expected: current `globalThis.crypto.randomUUID()` call throws a TypeError.

- [ ] **Step 3: Implement layered ID generation**

Add a module-level counter and a suffix function:

```ts
let fallbackSequence = 0

function randomSuffix(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID().replaceAll('-', '').slice(0, 12)
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(8))
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  }
  fallbackSequence += 1
  return `${Date.now().toString(36)}${fallbackSequence.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function newId(prefix: 'run' | 'revision' | 'node'): string {
  return `${prefix}-${randomSuffix()}`
}
```

- [ ] **Step 4: Run the full store suite to verify GREEN**

Run:

```text
npm test -- ../tests/integration/workflow-run-store.test.ts
```

Expected: all store tests pass under default crypto and both degraded environments.

- [ ] **Step 5: Commit Task 3**

Stage the two files and commit:

```text
fix(frontend): fall back when randomUUID is unavailable
```

---

### Task 4: Represent generation that has not started

**Files:**
- Modify: `tests/integration/workflow-run-store.test.ts`
- Modify: `frontend/src/entities/workflow-run/model/types.ts`
- Modify: `frontend/src/entities/workflow-run/local/machine.ts`

**Interfaces:**
- Consumes: `WorkflowRevision.generationStatus` and node progression.
- Produces: `GenerationStatus = 'not_started' | 'in_progress' | 'completed' | 'failed'` with lifecycle transitions.

- [ ] **Step 1: Write the failing lifecycle test**

Create a manual run and assert its initial revision is `not_started`. Complete its active asset node, then assert
the new current node is generation and the revision is `in_progress`. In the same test create a Quick Start run
and assert it starts `in_progress`.

- [ ] **Step 2: Write the restart boundary test**

After a manual run advances to generation, restart from its passed asset node. Assert the new revision's active
node is asset and its generation status is `not_started`. Restarting from generation must remain
`in_progress`.

- [ ] **Step 3: Run tests to verify RED**

Run:

```text
npm test -- ../tests/integration/workflow-run-store.test.ts -t "尚未开始|素材节点重启"
```

Expected: manual initial and asset-restart assertions receive `in_progress` instead of `not_started`.

- [ ] **Step 4: Implement the state and transitions**

Add `not_started` to `GenerationStatus`. In `initialRevision`, select by driver:

```ts
generationStatus: driver === 'ai' ? 'in_progress' : 'not_started'
```

When `appendNextNode` appends `generation`, return the revision with `generationStatus: 'in_progress'`.
When `restartRevision` activates asset, return `not_started`; when it activates generation or candidate, return
`in_progress`; for later nodes keep the source generation status.

- [ ] **Step 5: Run the store and selector suites to verify GREEN**

Run:

```text
npm test -- ../tests/integration/workflow-run-store.test.ts src/entities/workflow-run/model/selectors.test.ts
```

Expected: all tests pass and completed/failed gates remain unchanged.

- [ ] **Step 6: Commit Task 4**

Stage the three files and commit:

```text
fix(frontend): distinguish unstarted generation
```

---

### Task 5: Reject malformed persisted WorkflowRuns completely

**Files:**
- Create: `frontend/src/entities/workflow-run/local/validation.ts`
- Modify: `frontend/src/entities/workflow-run/local/store.ts`
- Modify: `tests/integration/workflow-run-store.test.ts`

**Interfaces:**
- Consumes: the full `WorkflowRun`, `WorkflowRevision`, and `WorkflowNode` domain shapes.
- Produces: `parseWorkflowRunMap(value: unknown): Record<string, WorkflowRun>` that filters invalid entries.

- [ ] **Step 1: Add a complete literal persisted-run fixture**

In the integration test, define a complete manual-run JSON object with all required run, revision, and node
fields. Do not generate expected fields through production helpers. Use distinct fixed IDs such as
`run-valid-storage`, `revision-valid-storage`, and `node-valid-storage`.

- [ ] **Step 2: Write malformed-record table tests**

For separate IDs, store records containing each defect and assert `fetchWorkflowRun(id)` rejects:

- missing `projectId`;
- invalid `driver`;
- missing revision `nodes`;
- invalid node `status`;
- `currentRevisionId` not found in `revisions`;
- storage map key different from `run.id`.

Add a valid sibling beside one invalid record and assert the valid sibling still loads.

- [ ] **Step 3: Run focused tests to verify RED**

Run:

```text
npm test -- ../tests/integration/workflow-run-store.test.ts -t "损坏记录|合法同级记录"
```

Expected: at least the record with only `id` and `revisions`-compatible fields is returned instead of rejected.

- [ ] **Step 4: Implement full structural validation**

Create `local/validation.ts` with these exact validator groups:

```ts
const DRIVERS = ['ai', 'manual'] as const
const RUN_STATUSES = ['active', 'completed', 'failed'] as const
const REVISION_STATUSES = ['active', 'completed', 'failed', 'abandoned'] as const
const NODE_STATUSES = ['locked', 'available', 'active', 'passed', 'failed'] as const
const GENERATION_STATUSES = ['not_started', 'in_progress', 'completed', 'failed'] as const
const EXPORT_STATUSES = ['not_exported', 'exporting', 'exported', 'failed'] as const
const PLAYTEST_STATUSES = ['not_tested', 'passed', 'issues_found'] as const
```

Use object, own-property, string-or-null, integer, enum, and string-array helpers. A node must own `input` and
`output`, have a node type in `WORKFLOW_NODE_ORDER`, and contain every other `WorkflowNode` field. A revision
must contain all fields and only valid nodes. A run must contain all fields, at least one valid revision, and a
`currentRevisionId` matching one of them.

Export only:

```ts
export function parseWorkflowRunMap(value: unknown): Record<string, WorkflowRun> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, WorkflowRun] => isWorkflowRun(entry[1]) && entry[0] === entry[1].id,
    ),
  )
}
```

Replace `isRunMap` in `store.ts` with `parseWorkflowRunMap(JSON.parse(raw))`.

- [ ] **Step 5: Run store tests to verify GREEN**

Run:

```text
npm test -- ../tests/integration/workflow-run-store.test.ts
```

Expected: every malformed case rejects, the valid sibling loads, and all existing workflow behavior passes.

- [ ] **Step 6: Commit Task 5**

Stage the validation, store, and integration test files and commit:

```text
fix(frontend): validate persisted workflow runs
```

---

### Task 6: Synchronize documentation and run complete verification

**Files:**
- Modify: `frontend/API_CONTRACT.md`
- Modify: `frontend/MODULES.md`
- Modify: `frontend/README.md`
- Modify: `frontend-architecture-v3.md`
- Verify: all Task 1–5 source and test files

**Interfaces:**
- Consumes: implemented async port, composition entry, storage guarantees, ID fallback, status lifecycle, and validator.
- Produces: one consistent written contract and fresh verification evidence.

- [ ] **Step 1: Update API and module documentation**

State that repository methods are Promise-based, all orchestration code uses the one composition entry, the
current adapter remains local, and no backend WorkflowRun endpoint exists. Document `not_started`, memory-wins
storage fallback, degraded ID support, and full hydration rejection.

- [ ] **Step 2: Update README and architecture status**

Describe future replacement as adding a remote/hybrid Adapter and changing only the composition entry. Keep
PR #62 domain ownership and the prohibition on invented WorkflowRun routes. Add the new regression guarantees
to the testing section.

- [ ] **Step 3: Run formatting and static checks**

Run from `frontend/`:

```text
npm run format
npm run format:check
npm run lint
npm run typecheck
```

Expected: every command exits 0.

- [ ] **Step 4: Run complete behavioral and build verification**

Run:

```text
npm run test
npm run build
git diff --check
```

Expected: all Vitest files pass, the production build succeeds, and no whitespace errors are reported.

- [ ] **Step 5: Audit the final boundary and scope**

Run from the worktree root:

```text
rg -n "localWorkflowRunRepository" frontend/src/entities/workflow-run/orchestration
rg -n "['\"`]\/workflow-runs?|['\"`]\/workflows" frontend/src
git status --short
```

Expected: no direct local-repository imports in orchestration, no runtime WorkflowRun HTTP path, and
`docs/frontend-backend-misalignment.md` remains unmodified and unstaged.

- [ ] **Step 6: Commit Task 6**

Stage only the four synchronized documents plus formatting changes belonging to Tasks 1–5, then commit:

```text
docs(frontend): document workflow repository guarantees
```

## Self-Review

- Spec coverage: async shape and one binding are Task 1; fallback data loss is Task 2; unsupported UUID is
  Task 3; missing lifecycle state is Task 4; hydration validation is Task 5; all documentation and verification
  requirements are Task 6.
- Placeholder scan: the plan contains no deferred implementation markers; every production change has an
  exact file, interface, focused failing test, implementation rule, and verification command.
- Type consistency: every layer uses the same Promise repository methods, the same `not_started` spelling, and
  `parseWorkflowRunMap(value: unknown): Record<string, WorkflowRun>`.
