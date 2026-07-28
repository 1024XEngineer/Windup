# Frontend Module Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the complete frontend module tree by responsibility, remove transport-level business mocks and cross-entity leakage, and enforce the resulting ownership rules in tests.

**Architecture:** Add a `capabilities` layer between features and entities for computation and upload ports. Keep entity lifecycle access in repositories, inject the Project repository from app composition, and leave shared as business-agnostic transport and utilities. Page and Feature public behavior stays the same.

**Tech Stack:** React 19, TypeScript 6, React Router 8, Vite 8, Vitest 4, Testing Library, Oxlint, Oxfmt.

## Global Constraints

- Modify only frontend code, frontend tests, and frontend documentation.
- Dependency direction is `app -> pages -> features -> capabilities -> entities -> shared`.
- Entity CRUD and repositories remain with their Entity; computation, upload, review, and export calls are Capabilities.
- Real/Mock selection occurs in app composition; production never imports or falls back to Mock.
- Do not invent Image Generation, Task SSE, Review, Export, or Playtest backend paths or DTOs.
- Keep the user-owned untracked `docs/frontend-backend-misalignment.md` untouched.
- Do not add additional authorship or co-author trailers to commits.

---

### Task 1: Introduce the Capability Layer and Move Image Generation

**Files:**
- Modify: `tests/integration/architecture.test.ts`
- Create: `frontend/src/capabilities/image-generation/index.ts`
- Create: `frontend/src/capabilities/image-generation/model/port.ts`
- Create: `frontend/src/capabilities/image-generation/model/types.ts`
- Create: `frontend/src/capabilities/image-generation/service.ts`
- Create: `frontend/src/capabilities/image-generation/service.test.ts`
- Delete: `frontend/src/entities/generation/index.ts`
- Delete: `frontend/src/entities/generation/model/port.ts`
- Delete: `frontend/src/entities/generation/model/types.ts`
- Delete: `frontend/src/entities/generation/service.ts`
- Delete: `frontend/src/entities/generation/service.test.ts`
- Modify: `frontend/src/entities/index.ts`

**Interfaces:**
- Produces: `createImageGenerationService(options): ImageGenerationService` from `@/capabilities/image-generation`.
- Produces: `ImageGenerationPort`, `ImageGenerationAdapterKind`, `ImageGenerationRuntime`, `GenerateImagesInput`, and `GeneratedImage`.

- [ ] **Step 1: Change the architecture and service tests before moving code**

Add `capabilities` to the allowed layer map and test the new import path:

```ts
const ALLOWED = {
  app: ['pages', 'features', 'capabilities', 'entities', 'shared'],
  pages: ['features', 'capabilities', 'entities', 'shared'],
  features: ['capabilities', 'entities', 'shared'],
  capabilities: ['entities', 'shared'],
  entities: ['shared'],
  shared: [],
}

expect(
  capabilityMockViolation(page, '@/capabilities/image-generation/adapters/mock')?.reason,
).toBe('生产代码不得直接选择能力 Mock Adapter')
```

Move the test import to `@/capabilities/image-generation` and rename generic exported types to slice-specific names.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- ../tests/integration/architecture.test.ts src/entities/generation/service.test.ts`

Expected: FAIL because `capabilities` is not a recognized layer and the new public module does not exist.

- [ ] **Step 3: Move the implementation and remove Entity exports**

Implement the same Promise service under the Capability slice:

```ts
export type ImageGenerationAdapterKind = 'real' | 'mock'
export type ImageGenerationRuntime = 'development' | 'test' | 'production'

export interface ImageGenerationPort {
  readonly adapterKind: ImageGenerationAdapterKind
  generate(input: GenerateImagesInput): Promise<GeneratedImage[]>
}
```

Keep the production guard and remove all generation exports from `frontend/src/entities/index.ts`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- ../tests/integration/architecture.test.ts src/capabilities/image-generation/service.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit Task 1**

```text
refactor(frontend): move image generation to capabilities
```

### Task 2: Extract Image Upload and Shared Pagination

**Files:**
- Create: `frontend/src/capabilities/image-upload/index.ts`
- Create: `frontend/src/capabilities/image-upload/model/port.ts`
- Create: `frontend/src/capabilities/image-upload/service.ts`
- Create: `frontend/src/capabilities/image-upload/service.test.ts`
- Create: `frontend/src/capabilities/image-upload/adapters/http.ts`
- Create: `frontend/src/capabilities/image-upload/adapters/http.test.ts`
- Create: `frontend/src/shared/pagination/index.ts`
- Modify: `frontend/src/shared/api/client/mappers/index.ts`
- Modify: `frontend/src/shared/api/index.ts`
- Modify: `frontend/src/entities/project/api.ts`
- Modify: `frontend/src/entities/project/index.ts`
- Modify: `frontend/src/entities/index.ts`
- Delete: `frontend/src/entities/project/api.test.ts`

**Interfaces:**
- Produces: `ImageUploadPort.upload(file): Promise<string>` and `createImageUploadService`.
- Produces: `httpImageUploadAdapter` with `adapterKind: 'real'`.
- Produces: `PageQuery` and `Paged<T>` from `@/shared/pagination`.

- [ ] **Step 1: Write failing tests for the new Capability path**

Move the existing file validation test to the HTTP adapter path and add a service injection test:

```ts
const adapter: ImageUploadPort = {
  adapterKind: 'mock',
  async upload() {
    return 'https://img.test/uploaded.png'
  },
}

await expect(
  createImageUploadService({ adapter, runtime: 'development' }).upload(file),
).resolves.toBe('https://img.test/uploaded.png')
```

Also assert production rejects a Mock adapter before upload.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- src/capabilities/image-upload/service.test.ts src/capabilities/image-upload/adapters/http.test.ts`

Expected: FAIL because the image-upload Capability does not exist.

- [ ] **Step 3: Implement the Capability and pagination move**

Use this Port:

```ts
export interface ImageUploadPort {
  readonly adapterKind: 'real' | 'mock'
  upload(file: File): Promise<string>
}
```

Move jpeg/png/webp/gif and 10 MiB validation into the HTTP adapter, then call
`uploadFile<{ url: string }>('/upload/image', file)`. Move `PageQuery` and `Paged<T>` to
`shared/pagination` and update API mappers and Project imports.

- [ ] **Step 4: Remove Project ownership of upload and verify GREEN**

Remove `uploadImage` from Project API and both Entity facades.

Run: `npm test -- src/capabilities/image-upload/service.test.ts src/capabilities/image-upload/adapters/http.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit Task 2**

```text
refactor(frontend): separate upload and pagination ownership
```

### Task 3: Separate Entities and Remove Cross-Entity Leakage

**Files:**
- Create: `frontend/src/entities/task/index.ts`
- Create: `frontend/src/entities/provider-session/index.ts`
- Create: `frontend/src/entities/workflow-run/model/task-link.ts`
- Modify: `frontend/src/entities/workflow-run/index.ts`
- Modify: `frontend/src/entities/index.ts`
- Modify: `frontend/src/entities/public-contracts.test.ts`
- Modify: `frontend/src/entities/character/types.ts`
- Modify: `frontend/src/entities/workflow-run/model/types.ts`
- Modify: `frontend/src/features/generation/index.tsx`
- Create: `frontend/src/features/generation/provider-connection/README.md`
- Delete: `frontend/src/features/generation/provider-session/index.ts`
- Delete: `frontend/src/features/generation/provider-session/README.md`
- Delete: `frontend/src/entities/workflow-run/model/task.ts`
- Delete: `frontend/src/entities/workflow-run/model/revision.ts`
- Delete: `frontend/src/entities/workflow-run/model/queries.ts`
- Delete: `frontend/src/shared/api/request.ts`
- Delete: `frontend/src/shared/api/stream.ts`
- Delete: `frontend/src/shared/testing/index.ts`
- Delete: `frontend/src/pages/home/README.md`
- Modify: `tests/integration/architecture.test.ts`

**Interfaces:**
- Produces: Task types and `subscribeTask` from `entities/task` and aggregate `@/entities`.
- Produces: `WorkflowTaskLink` from WorkflowRun while keeping the aggregate public type stable.
- Produces: Provider Session types from `entities/provider-session` and aggregate `@/entities`.
- Removes: `Action.sourceWorkflowRunId`, `WorkflowLocation`, and `workflowRunKeys`.

- [ ] **Step 1: Change public contract tests before production types**

Make the Character contract reject the cross-entity field:

```ts
expectTypeOf<Action>().not.toHaveProperty('sourceWorkflowRunId')
```

Keep the existing literal shape assertion for `WorkflowTaskLink` and import Provider Session types from
`@/entities` in the Generation Feature.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/entities/public-contracts.test.ts`

Expected: FAIL because Action still contains `sourceWorkflowRunId`.

- [ ] **Step 3: Split Task and Provider Session**

Put `TaskStatus`, `Task`, `TaskEvent`, and `subscribeTask` in `entities/task/index.ts`. Put this association in
`workflow-run/model/task-link.ts`:

```ts
export interface WorkflowTaskLink {
  taskId: Task['id']
  runId: WorkflowRun['id']
  revisionId: WorkflowRevision['id']
  nodeId: WorkflowNode['id']
}
```

Move Provider types to `entities/provider-session` and make the Generation UI import
`ProviderSessionStatus` from `@/entities`.

- [ ] **Step 4: Remove unused correlation and compatibility surfaces**

Remove `sourceWorkflowRunId`, `WorkflowLocation`, `workflowRunKeys`, their exports, and the confirmed dead files
listed above. Rename the Provider UI planning directory to `provider-connection`.

- [ ] **Step 5: Run focused architecture and contract tests**

Run: `npm test -- src/entities/public-contracts.test.ts ../tests/integration/architecture.test.ts`

Expected: all focused tests pass.

- [ ] **Step 6: Commit Task 3**

```text
refactor(frontend): correct entity ownership boundaries
```

### Task 4: Replace the Global Project Mock with App Composition

**Files:**
- Create: `frontend/src/entities/project/model/repository.ts`
- Create: `frontend/src/entities/project/http-repository.ts`
- Create: `frontend/src/app/composition/types.ts`
- Create: `frontend/src/app/composition/production.ts`
- Create: `frontend/src/app/composition/development.ts`
- Create: `frontend/src/app/composition/index.ts`
- Create: `frontend/src/app/composition/mocks/project.ts`
- Create: `frontend/src/app/composition/mocks/project.test.ts`
- Modify: `frontend/src/entities/project/index.ts`
- Modify: `frontend/src/entities/index.ts`
- Delete: `frontend/src/entities/project/api.ts`
- Modify: `frontend/src/features/quick-start/index.ts`
- Modify: `frontend/src/features/quick-start/start-quick-start.ts`
- Modify: `frontend/src/features/quick-start/start-quick-start.test.ts`
- Modify: `frontend/src/pages/projects/index.tsx`
- Modify: `frontend/src/pages/project-detail/index.tsx`
- Modify: `frontend/src/pages/quick-start/index.tsx`
- Modify: `frontend/src/app/index.tsx`
- Modify: `frontend/src/app/asset-library-flow.test.tsx`
- Modify: `frontend/src/app/quick-start-flow.test.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/shared/api/index.ts`
- Delete: `frontend/src/shared/api/client/mock/index.ts`
- Delete: `frontend/src/shared/api/client/mock/types.ts`
- Delete: `frontend/src/shared/api/client/mock/project-handlers.ts`
- Delete: `frontend/src/shared/api/client/mock/project-handlers.test.ts`
- Modify: `tests/integration/architecture.test.ts`

**Interfaces:**
- Produces: `ProjectRepository.list/get/create/remove`, all Promise-based.
- Produces: `createHttpProjectRepository({ currentUserId })`.
- Produces: `useProjects(repository, query)` and `useProject(repository, id)` without a hidden global binding.
- Produces: `AppServices { projects: ProjectRepository }`.
- Produces: `createDevelopmentAppServices()` and `loadAppServices()`.
- Changes: `App`, `ProjectsPage`, `ProjectDetailPage`, and `QuickStartPage` receive explicit services/repository props.

- [ ] **Step 1: Write failing Repository and App composition tests**

Create a memory Repository test with hand-checked data:

```ts
const repository = createMemoryProjectRepository()
const created = await repository.create(projectInput)
expect(created.id).toBe('3')
expect((await repository.list({ page: 1, pageSize: 20 })).items[0]).toEqual(created)
await expect(repository.create(projectInput)).rejects.toThrow('项目名称已存在')
```

Update App flow tests to render with `services={createDevelopmentAppServices()}`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- src/app/composition/mocks/project.test.ts src/app/quick-start-flow.test.tsx`

Expected: FAIL because app composition and ProjectRepository do not exist.

- [ ] **Step 3: Implement ProjectRepository and adapters**

Use this contract:

```ts
export interface ProjectRepository {
  list(query?: PageQuery): Promise<Paged<Project>>
  get(id: Project['id']): Promise<Project>
  create(input: CreateProjectInput): Promise<Project>
  remove(id: Project['id']): Promise<void>
}
```

Move the current DTO conversion into `createHttpProjectRepository({ currentUserId })`. Implement the development
memory Repository directly in domain shapes; do not emulate URLs or response envelopes. Keep the Project hooks in
the Entity, but require a `ProjectRepository` as their first argument so tests and app composition remain explicit.

- [ ] **Step 4: Add explicit app composition and inject it**

Define:

```ts
export interface AppServices {
  projects: ProjectRepository
}
```

`loadAppServices()` returns production services when `import.meta.env.PROD` or
`VITE_PROJECT_ADAPTER === 'http'`; otherwise it dynamically imports `./development`. `main.tsx` awaits the loader
before rendering `<App services={services} />`.

Pages use the injected Repository. Quick Start passes `services.projects.create` into
`createQuickStartStarter`; remove the module-level default `startQuickStart` singleton.

- [ ] **Step 5: Delete shared business Mock and make shared API real-only**

Remove `shared/api/client/mock` and make `request`/`requestList` delegate only to `realRequest`. Update the
architecture guard so only `app/composition/development.ts` may import a path segment named `mock` or `mocks`.

- [ ] **Step 6: Run focused and integration tests**

Run: `npm test -- src/app/composition/mocks/project.test.ts src/app/quick-start-flow.test.tsx src/app/asset-library-flow.test.tsx ../tests/integration/architecture.test.ts`

Expected: all focused tests pass and Quick Start persists the Project Repository ID.

- [ ] **Step 7: Commit Task 4**

```text
refactor(frontend): compose project repository in app
```

### Task 5: Lock the Global Module Registry and Synchronize Documentation

**Files:**
- Modify: `tests/integration/architecture.test.ts`
- Modify: `frontend/README.md`
- Modify: `frontend/MODULES.md`
- Modify: `frontend/API_CONTRACT.md`
- Modify: `frontend-architecture-v3.md`
- Modify: `docs/superpowers/specs/2026-07-28-quick-start-capability-adapters-design.md`
- Modify: `docs/superpowers/plans/2026-07-28-quick-start-capability-adapters.md`

**Interfaces:**
- Produces: an exact declared Slice registry for pages, features, capabilities, entities, and shared.
- Produces: documentation matching the implemented composition and public imports.

- [ ] **Step 1: Write the failing registry-helper test**

Add a pure helper and first assert that it reports an undeclared fixture:

```ts
expect(moduleOwnershipViolation('entities', ['project', 'generation'])).toEqual(
  'entities 存在未声明 Slice：generation',
)
```

Declare exact sorted roots:

```ts
const DECLARED_SLICES = {
  pages: ['asset-library', 'home', 'not-found', 'playtest', 'project-detail', 'projects', 'quick-start', 'workflow-editor'],
  features: ['character-setup', 'export', 'generation', 'quick-start', 'review'],
  capabilities: ['image-generation', 'image-upload'],
  entities: ['action-template', 'character', 'project', 'provider-session', 'task', 'wearable', 'workflow-run'],
  shared: ['api', 'hooks', 'pagination', 'ui'],
}
```

- [ ] **Step 2: Run architecture tests and verify RED**

Run: `npm test -- ../tests/integration/architecture.test.ts`

Expected: FAIL because `moduleOwnershipViolation` is not implemented.

- [ ] **Step 3: Implement the registry check and update documents**

Scan immediate directories for each declared layer, compare sorted literal arrays, and report undeclared or missing
Slices. Update all four frontend documents and mark the earlier image-generation location plan as superseded by
the global module ownership design.

Document `VITE_PROJECT_ADAPTER=http`, explicit App services, Capability slice imports, Task and Provider ownership,
and the removed Action/Workflow correlation.

- [ ] **Step 4: Run architecture and contract tests**

Run: `npm test -- ../tests/integration/architecture.test.ts src/entities/public-contracts.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit Task 5**

```text
docs(frontend): synchronize module ownership contracts
```

### Task 6: Full Verification and PR Update

**Files:**
- Review every file changed in Tasks 1–5.

- [ ] **Step 1: Run the complete frontend gate**

Run in `frontend/`:

```text
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

- [ ] **Step 2: Audit the final repository state**

Run `git diff --check`, review every commit and diff, scan for stale `entities/generation`, `VITE_USE_MOCK`,
`sourceWorkflowRunId`, `WorkflowLocation`, and business code under `shared/api/client/mock`.

Confirm `docs/frontend-backend-misalignment.md` remains the only unrelated untracked file.

- [ ] **Step 3: Verify production composition**

Confirm the production composition imports only the HTTP Project Repository and that the production build output
does not contain the development seed project names.

- [ ] **Step 4: Push normally to PR #59**

Fetch `origin/feat/58-frontend-skeleton`, confirm zero remote divergence, and use a normal fast-forward push. Do not
force-push or alter existing commit authorship.
