# Cocos Creator 一键导出实现计划

> **已被取代：** 本计划记录早期“下载 ZIP + CLI 导入”阶段。网页连接 Creator 全局扩展的一键导入实施以 `docs/superpowers/plans/2026-08-20-cocos-web-one-click-import.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏通用导出契约的前提下，为 Windup 增加一个可下载、可验证并可导入 Cocos Creator 3.x 的适配包。

**Architecture:** 复用 `AssetExportTarget` 扩展点，让前端导出器在通用 ZIP 中追加 `targets/cocos-creator/` 清单；当前 Cocos 侧先提供纯 Node CLI，将清单与通用图片转换为按 Creator 3.x 结构组织的 SpriteFrame、AnimationClip、Prefab 及 `.meta`。Creator 3.x 扩展待真实运行时验证后再接入。通用层仍是唯一事实源，导入器只消费清单，不反向修改通用导出逻辑。

**Tech Stack:** React 19 + TypeScript + Vitest + Vite；Node.js ESM `node:test`；Cocos Creator 3.x ES module 扩展 API（延期接入）。

**Spec:** GitHub Issue #94（当前已关闭，作为历史契约参考）与附件 `windup-cocos-export-import.zip` 中的 Cocos 清单、导入器和硬验证样本。

## Global Constraints

- Cocos target 不得修改 `meta.json`、`schema.json`、`frames/` 或 `atlas/` 的通用目录和字段。
- 导出前继续执行现有质量门禁；任一缺帧、PNG、尺寸或路径校验失败都不得下载残缺包。
- Cocos 清单使用 `anchor_cocos = { x, y: 1 - y }`；manifest、CLI 和未来扩展必须共享同一规则。
- 本阶段没有可用的真实 Creator 3.x 实例；UI 和文档必须明确“适配包/导入器”状态，不能声称已完成真实拖入即播放验收。
- 不新增第三方 npm 依赖；CLI 仅使用 Node 内置模块，ZIP 仅支持导出器当前使用的 STORED 格式。
- 不创建新 Git 分支，不直接修改上游仓库；代码先在当前 Windup PR 工作区完成并本地验证。

---

### Task 1: Cocos target 清单与前端一键导出入口

**Files:**
- Modify: `frontend/src/features/export-package/cocos-target.ts`
- Create: `frontend/src/features/export-package/cocos-target.test.ts`
- Modify: `frontend/src/features/export-package/export-panel.tsx`
- Modify: `frontend/src/features/export-package/export-panel.test.tsx`
- Modify: `frontend/src/features/export-package/index.ts`

**Interfaces:**
- Consumes: `AssetExportTargetContext`, `ExportPackageModel`, `GenericExportMetadata`, `PlannedSequence`。
- Produces: `cocosCreatorTarget`, `COCOS_IMPORT_SCHEMA_VERSION`, `toCocosAnchor`；面板提供默认开启的“导出 Cocos Creator 包”按钮，并允许测试通过 `enableCocosExport={false}` 隐藏。

- [x] **Step 1: Write the failing tests**
  - 验证 target id、清单版本、`experimental`/`engine` 字段、角色和动作的坐标翻转、帧时长兜底、路径与 README。
  - 验证面板同时保留通用导出按钮，并在质量问题或另一导出任务运行时禁用 Cocos 按钮。
- [x] **Step 2: Run the focused frontend tests and confirm failure**
  - Run: `cd frontend; npm test -- src/features/export-package/cocos-target.test.ts src/features/export-package/export-panel.test.tsx`
  - Expected: target export and Cocos button assertions fail because the target remains a placeholder and the panel has no Cocos action.
- [x] **Step 3: Implement the target and button**
  - Build `cocos-import.json` from the plan, preserve generic paths, include explicit duration or `Math.round(1000 / fps)`, and generate an honest import README.
  - Use a separate export state for the Cocos button; never let one button’s phase overwrite the other.
- [x] **Step 4: Run focused tests and typecheck**
  - Run: `cd frontend; npm test -- src/features/export-package/cocos-target.test.ts src/features/export-package/export-panel.test.tsx; npm run typecheck`
  - Expected: all focused tests pass and TypeScript exits 0.

### Task 2: Node Cocos importer core and deterministic output

**Files:**
- Create: `tools/cocos-importer/package.json`
- Create: `tools/cocos-importer/src/zip-reader.js`
- Create: `tools/cocos-importer/src/manifest-reader.js`
- Create: `tools/cocos-importer/src/asset-planner.js`
- Create: `tools/cocos-importer/src/cocos-bridge.js`
- Create: `tools/cocos-importer/bin/windup-cocos-import.mjs`
- Create: `tools/cocos-importer/test/manifest-reader.test.mjs`
- Create: `tools/cocos-importer/test/asset-planner.test.mjs`
- Create: `tools/cocos-importer/test/bridge-uuid.test.mjs`
- Create: `tools/cocos-importer/test/e2e-cli.test.mjs`
- Create: `tools/cocos-importer/test/verify-output.mjs`

**Interfaces:**
- Consumes: `cocos-import.json` plus generic ZIP entries produced by Task 1.
- Produces: `parseManifest`, `validateManifest`, `planImport`, `uuidForPath`, `buildCocosMetaFiles`, CLI flags `<input.zip> --out <dir>`, `--dry-run` and explicit `--force`.

- [x] **Step 1: Write failing Node tests**
  - Cover invalid JSON/manifest fields, path-safe planning, duration fallback, deterministic 24-character UUIDs, CLI dry-run, and a real ZIP-to-output run.
- [x] **Step 2: Run importer tests and confirm failure**
  - Run: `cd tools/cocos-importer; node --test test/manifest-reader.test.mjs test/asset-planner.test.mjs test/bridge-uuid.test.mjs test/e2e-cli.test.mjs`
  - Expected: module/CLI files are missing and tests fail.
- [x] **Step 3: Implement ZIP reader, manifest validation, planner, bridge and CLI**
  - Reject unsupported compression methods and unsafe paths.
  - Copy source PNGs, emit `.meta`, `.anim`, `.prefab`, and keep SpriteFrame child UUID references internally consistent.
  - Preflight every source file, reject dangerous output ancestors, require explicit `--force` for replacement, and keep `--dry-run` read-only.
- [x] **Step 4: Run Node tests and hard validation**
  - Run the four Node test files, then `node test/verify-output.mjs <generated-output> 64 64` against the supplied fixture.
  - Expected: all tests pass; every PNG, `.meta`, `.anim` and `.prefab` reference resolves.

### Task 3: Creator 3.x extension packaging and documentation (deferred)

**Files:**
- Deferred: `tools/cocos-importer/main.js` until a real Creator 3.x runtime is available.
- Modify: `tools/cocos-importer/README.md`
- Modify: `frontend/src/features/export-package/README.md`

**Interfaces:**
- Consumes: Task 2 manifest/planner/bridge behavior and the Creator extension’s `Editor`/`assetdb` APIs.
- Produces: a copyable `extensions/windup-importer/` extension with ZIP picker, dry-run preview, and import action.

- [x] **Step 1: Verify the extension API boundary**
  - Official Creator 3.8 documentation requires an ES module panel package; the attached CommonJS entrypoint is not copied into the repository.
- [x] **Step 2: Keep the extension isolated until runtime validation**
  - The current implementation exposes the verified Node CLI instead of an unverified Creator extension.
- [x] **Step 3: Document installation, limitations, and verification**
  - Documentation states that Creator extension support is deferred and that CLI UUIDs are deterministic.
- [ ] **Step 4: Run the real Creator 3.x validation**
  - Blocked until a usable Creator 3.x project can open the generated `.anim`, `.meta` and `.prefab` files; the Node hard validation is complete.

### Task 4: End-to-end regression gate

**Files:**
- Create: `frontend/src/features/export-package/cocos-target.e2e.test.ts`
- Create: `frontend/src/features/export-package/cocos-target.e2e.extract.test.ts`

**Interfaces:**
- Consumes: Task 1 target and the existing browser ZIP runtime.
- Produces: regression coverage that a realistic export contains the generic contract plus `targets/cocos-creator/cocos-import.json` and README, and that the generated ZIP can be parsed without a browser.

- [x] **Step 1: Add an in-memory RGBA PNG runtime and STORED ZIP reader**
- [x] **Step 2: Assert the full target export and extracted paths**
- [x] **Step 3: Run the E2E files with the existing Vitest configuration**
- [x] **Step 4: Run the final available verification commands and record the Creator-runtime limitation explicitly**
