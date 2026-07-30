# Frontend Architecture Guardrails

This document governs frontend changes as the product workflow evolves. It takes precedence over early skeleton references to an asset library or reusable assets.

## Module Direction

```text
app -> pages -> features -> workflow-controller / entities -> shared
```

Dependencies move only to the right. `workflow-controller` may use entity contracts; entities do not use the controller. `shared` is business-agnostic and imports none of the other layers. Use each module's public entrypoint rather than a deep implementation import.

- `app` starts the application and owns routing, global layout, and app-wide providers.
- `pages` translate route state into a product scene and compose features. They do not implement domain transitions or call transport code directly.
- `features` own user-facing capabilities and may prepare controller inputs or call entity APIs. They do not own a second workflow state machine.
- `workflow-controller` owns `WorkflowRun` progression, revision lineage, restart, interruption, and application of async results.
- `entities` own business types and stable frontend API contracts. `shared` contains only generic UI, hooks, utilities, and validated runtime configuration.

## Backend Boundary

Backend URLs, DTO envelopes, media handling, authentication, events, and error formats remain unstable until explicitly frozen. Keep their translation behind an entity API adapter:

- Pages, features, and the controller depend on frontend entity contracts, never backend DTOs or direct `fetch` calls.
- Adapters validate and map untrusted transport data to frontend types. `unknown` results must be narrowed before business use.
- Do not promote a temporary endpoint shape into shared types, page props, or workflow rules. Change the adapter contract deliberately, with its callers and tests, when the backend contract is frozen.

## Workflow Invariants

`WorkflowRun` is a project-owned record shared by Quick Start and Workflow Editor. A run has one current revision; historical revisions are read-only. Async work is associated with the revision that started it, and a result for an obsolete revision must be ignored.

The product currently presents five ordered workflow stages. Treat that order as per-run configuration, not a permanently hard-coded stage count or array index: future products may configure a different sequence. Supporting model step names may be more granular, but the visible stage order must remain explicit.

Restarting from a selected stage creates a new descendant revision. The new lineage preserves inputs through that selected stage only; it invalidates or removes all downstream execution, outputs, and completion evidence. The source revision stays intact for history, but its downstream results are not valid inputs to the new lineage.

Only successful system QC marks a version complete. Playtest is downstream, read-only verification and cannot change a run or revision to completed. Export is a separate post-completion action and separately records that a completed version was exported; it does not redefine completion.

## Product Surface Boundaries

- **Quick Start** accepts intent and references, drives the same `WorkflowRun` automatically, and hides stages, revisions, restart mechanics, and other workflow internals.
- **Workflow Editor** exposes the configured stage sequence and is the only surface for deliberate step-level editing, revision history, and restart.
- **Playtest** consumes a selected completed version as a read-only inspection target. It may save an independent inspection conclusion, but never changes characters, frames, workflow data, QC, completion, or export state.

Completed versions are project-scoped history, retained for traceability and selectable for import into Playtest. They are not a reusable asset library: do not add cross-project browsing, copying, sharing, or reuse contracts/UI without an explicit product decision.

## Pre-change Review

- Is the code in the lowest layer that can own it, with dependencies following the direction above?
- Does every backend interaction remain behind a typed entity adapter rather than leaking provisional transport data?
- Does workflow behavior preserve one current revision, ignore stale async results, and invalidate downstream work after restart?
- Does completion come only from system QC, with Playtest and export kept separate?
- Does the UI preserve Quick Start, Workflow Editor, and Playtest boundaries and keep completed-version history inside its project?
- Do focused tests cover the changed contract, especially restart lineage, stale results, status transitions, and read-only Playtest behavior?
