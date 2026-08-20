# Cocos Creator 网页一键导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户首次安装并配对 Cocos Creator 3.8.8 全局扩展后，可以从 Windup 网页单击完成 2D 资产导入、AssetDB 刷新、引用校验和 Prefab 定位。

**Architecture:** 网页继续生成带 Cocos target 清单的 Windup 通用 ZIP，并通过固定 localhost HTTP 协议把 ZIP 交给 Creator 扩展。CLI 与扩展复用同一套纯 Node 导入核心；扩展只负责配对、HTTP、事务写盘和 Editor API，网页不复制 Cocos 序列化逻辑。

**Tech Stack:** React 19、TypeScript 6、Vitest 4、Node.js ESM、`node:test`、Cocos Creator 3.8.8 Extension API、Editor Message/AssetDB、浏览器 Fetch/Web Crypto。

**Spec:** `docs/superpowers/specs/2026-08-20-cocos-web-one-click-import-design.md`

## Global Constraints

- 只支持 Cocos Creator `>=3.8.8 <3.9.0` 的 2D 项目。
- HTTP 服务固定监听 `127.0.0.1:17832`；禁止监听任意外部接口。
- Cocos 原生序列化只保留在 `tools/cocos-importer`，前端不得复制 `.meta/.anim/.prefab` 生成代码。
- 所有导入只能写入当前工程的 `assets/windup-imports/`，网页不得提供本地输出路径。
- Sprite 必须使用 CUSTOM size mode，默认帧率必须使用精确 `index / fps`。
- 新增代码不引入运行时第三方依赖，不降低现有覆盖率门禁，并尽可能覆盖失败、重试、幂等和回滚分支。
- 保留通用 ZIP 下载；扩展不可用或版本不兼容时必须可以降级下载。
- 不创建新分支，不直接 push 或 commit 到 `1024XEngineer/Windup`。

---

### Task 1: 固化 Cocos 1.1 清单与精确动画时间

**Files:**
- Modify: `frontend/src/features/export-package/cocos-target.ts`
- Modify: `frontend/src/features/export-package/cocos-target.test.ts`
- Modify: `tools/cocos-importer/src/manifest-reader.js`
- Modify: `tools/cocos-importer/src/asset-planner.js`
- Modify: `tools/cocos-importer/src/cocos-bridge.js`
- Modify: `tools/cocos-importer/test/manifest-reader.test.mjs`
- Modify: `tools/cocos-importer/test/asset-planner.test.mjs`
- Modify: `tools/cocos-importer/test/bridge-uuid.test.mjs`

**Interfaces:**
- Produces: `COCOS_IMPORT_SCHEMA_VERSION = 'windup-cocos-import-1.1.0'`。
- Produces: `timing_mode: 'constant-fps' | 'per-frame'`。
- Produces: every planned animation frame has `{ index, time, duration, spriteFramePath }` in seconds。
- Compatibility: `parseManifest()` continues accepting `windup-cocos-import-1.0.0`。

- [ ] **Step 1: Write failing timing and fixed-size tests**

```ts
expect(manifest.schema_version).toBe('windup-cocos-import-1.1.0')
expect(manifest.actions[0].timing_mode).toBe('constant-fps')
expect(manifest.actions[0].frames[0].duration_ms).toBeNull()
```

```js
assert.deepEqual(animation.frames.map((frame) => frame.time), [0, 1 / 12, 2 / 12])
assert.equal(prefabSprite._sizeMode, 0)
assert.equal(prefabUiTransform._contentSize.width, 256)
assert.equal(prefabUiTransform._contentSize.height, 256)
```

- [ ] **Step 2: Run the focused tests and confirm the old rounded timing fails**

Run:

```powershell
Set-Location frontend
npm test -- src/features/export-package/cocos-target.test.ts
Set-Location ../tools/cocos-importer
node --test test/manifest-reader.test.mjs test/asset-planner.test.mjs test/bridge-uuid.test.mjs
```

Expected: schema/timing assertions fail because the current manifest is 1.0 and uses rounded milliseconds; size-mode assertion fails with `_sizeMode: 1`.

- [ ] **Step 3: Implement 1.1 timing without breaking 1.0 input**

Use `duration_ms: null` for constant-fps frames. In `planImport`, calculate each frame as:

```js
const duration = action.timing_mode === 'per-frame'
  ? frame.duration_ms / 1000
  : 1 / action.fps
const time = action.timing_mode === 'per-frame'
  ? elapsed
  : index / action.fps
```

Set the generated Sprite to `_sizeMode: 0` and `_isTrimmedMode: false` while retaining the manifest canvas dimensions in UITransform.

- [ ] **Step 4: Run frontend and importer coverage**

```powershell
Set-Location frontend
npm run test:coverage -- src/features/export-package/cocos-target.test.ts
Set-Location ../tools/cocos-importer
npm test
```

Expected: all focused tests pass; new timing branches and both schema versions are exercised.

### Task 2: 抽取 CLI 与扩展共享的导入核心

**Files:**
- Create: `tools/cocos-importer/src/import-core.js`
- Modify: `tools/cocos-importer/bin/windup-cocos-import.mjs`
- Create: `tools/cocos-importer/test/import-core.test.mjs`
- Modify: `tools/cocos-importer/package.json`

**Interfaces:**
- Produces: `prepareImport(input: Uint8Array): Promise<PreparedImport>`。
- Produces: `PreparedImport = { manifest, plan, files: Map<string, Uint8Array>, packFolder, summary }`。
- Produces: `validatePreparedImport(prepared): ImportSummary`。
- CLI consumes these functions; extension consumes them in Task 5.

- [ ] **Step 1: Write tests proving the core is filesystem-independent**

```js
const prepared = await prepareImport(zipBytes)
assert.equal(prepared.summary.animationCount, 2)
assert.equal(prepared.summary.frameCount, 64)
assert.ok(prepared.files.has(`${prepared.packFolder}/prefabs/网站看板娘-默认造型.prefab`))
assert.doesNotThrow(() => validatePreparedImport(prepared))
```

- [ ] **Step 2: Run the test and confirm `prepareImport` is missing**

```powershell
Set-Location tools/cocos-importer
node --test test/import-core.test.mjs
```

Expected: FAIL because `src/import-core.js` does not exist.

- [ ] **Step 3: Move parsing, planning and output assembly behind the pure interface**

`prepareImport` accepts bytes and returns files without reading or writing disk. Keep directory-input compatibility in the CLI adapter; do not put CLI flags, console output, `process.exit` or Editor calls into `import-core.js`.

- [ ] **Step 4: Refactor the CLI to write `PreparedImport.files`**

Keep `--out`, `--dry-run`, `--force` and existing dangerous-output checks. The same real ZIP must produce byte-identical `.anim`, `.prefab` and `.meta` files before and after refactoring.

- [ ] **Step 5: Run the complete importer suite**

```powershell
Set-Location tools/cocos-importer
npm test
node test/verify-output.mjs test/.tmp-cli-out 256 256
```

Expected: all tests pass and every generated UUID reference resolves.

### Task 3: 实现本地协议客户端和首次配对

**Files:**
- Create: `frontend/src/features/export-package/cocos-bridge-client.ts`
- Create: `frontend/src/features/export-package/cocos-bridge-client.test.ts`
- Modify: `frontend/src/features/export-package/index.ts`

**Interfaces:**
- Produces: `CocosBridgeClient` with `health()`, `pair(code)`, `submit(blob, requestId)`, and `getJob(jobId)`.
- Produces: `CocosBridgeError` with stable codes `PLUGIN_UNAVAILABLE`, `PAIRING_REQUIRED`, `ORIGIN_DENIED`, `VERSION_UNSUPPORTED`, `IMPORT_FAILED`.
- Storage key: `windup:cocos-bridge:token:v1`.

- [ ] **Step 1: Write fetch-contract tests**

```ts
const client = new CocosBridgeClient({ fetch, storage, baseUrl: 'http://127.0.0.1:17832' })
await client.pair('123456')
expect(storage.getItem('windup:cocos-bridge:token:v1')).toBe('issued-token')
expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17832/v1/pair', expect.objectContaining({ method: 'POST' }))
```

Cover timeout, aborted request, 401 token removal, protocol mismatch, SHA-256 header, 202 parsing and job polling response validation.

- [ ] **Step 2: Run the test and confirm the client is missing**

```powershell
Set-Location frontend
npm test -- src/features/export-package/cocos-bridge-client.test.ts
```

- [ ] **Step 3: Implement the client with injected fetch and storage**

Use a 2-second health timeout and a 30-second upload timeout. Compute SHA-256 with `crypto.subtle.digest`; never log or expose the bearer token.

- [ ] **Step 4: Run coverage and typecheck**

```powershell
Set-Location frontend
npm run test:coverage -- src/features/export-package/cocos-bridge-client.test.ts
npm run typecheck
```

Expected: all error mappings and token lifecycle branches pass.

### Task 4: 把导出面板改为“一键导入 + 下载降级”

**Files:**
- Create: `frontend/src/features/export-package/cocos-one-click.ts`
- Create: `frontend/src/features/export-package/cocos-one-click.test.ts`
- Modify: `frontend/src/features/export-package/export-panel.tsx`
- Modify: `frontend/src/features/export-package/export-panel.test.tsx`

**Interfaces:**
- Produces: `importIntoCocos(model, client, onPhase): Promise<CocosImportResult>`。
- Phases: `detecting | validating | packing | uploading | converting | writing | refreshing | verifying`。
- Reuses: `exportGameAssets(model, { targets: [cocosCreatorTarget] })` without clicking a download anchor.

- [ ] **Step 1: Write orchestration and UI tests**

Test these user-visible paths: paired success; first-time code form; invalid code; plugin missing with download fallback; Creator project missing; upload failure; job failure with rollback status; double-click suppression; retry reuses the already built Blob during the same page session.

```tsx
await user.click(screen.getByRole('button', { name: '一键导入 Cocos' }))
expect(await screen.findByText('已导入到当前 Cocos 工程')).toBeVisible()
expect(screen.getByText('2 个动作，64 帧')).toBeVisible()
```

- [ ] **Step 2: Run tests and confirm the current download-only UI fails**

```powershell
Set-Location frontend
npm test -- src/features/export-package/cocos-one-click.test.ts src/features/export-package/export-panel.test.tsx
```

- [ ] **Step 3: Implement one-click orchestration and pairing form**

Replace the experimental claim with the verified state returned by `/v1/health`. Keep “下载 Cocos 包” as a secondary button and do not remove “导出游戏资产包”.

- [ ] **Step 4: Run the complete frontend quality gate**

```powershell
Set-Location frontend
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Expected: every command exits 0; existing repository coverage threshold is not reduced.

### Task 5: 构建无第三方运行时依赖的 Creator 全局扩展

**Files:**
- Create: `tools/cocos-importer/extension/package.json`
- Create: `tools/cocos-importer/extension/source/main.js`
- Create: `tools/cocos-importer/extension/source/http-server.js`
- Create: `tools/cocos-importer/extension/source/pairing-store.js`
- Create: `tools/cocos-importer/extension/source/protocol.js`
- Create: `tools/cocos-importer/extension/scripts/build.mjs`
- Create: `tools/cocos-importer/extension/scripts/verify-package.mjs`
- Create: `tools/cocos-importer/extension/test/http-server.test.mjs`
- Create: `tools/cocos-importer/extension/test/pairing-store.test.mjs`

**Interfaces:**
- Main entry: `dist/main.js` with `load()` and `unload()`.
- HTTP bind: `{ host: '127.0.0.1', port: 17832 }`.
- Pairing persistence: exact Origin plus SHA-256 token digest in Creator global Profile.
- Build output: `tools/cocos-importer/dist/windup-cocos-importer.zip`.

- [ ] **Step 1: Write real HTTP server tests on an ephemeral loopback port**

```js
const server = await startServer({ host: '127.0.0.1', port: 0, profile, jobs })
const address = server.address()
assert.equal(address.address, '127.0.0.1')
```

Cover OPTIONS, unpaired health, five-attempt lockout, five-minute expiry, wrong Origin, missing token, token digest comparison, invalid protocol, excessive Content-Length and clean shutdown.

- [ ] **Step 2: Run tests and confirm the extension modules are missing**

```powershell
Set-Location tools/cocos-importer/extension
node --test test/http-server.test.mjs test/pairing-store.test.mjs
```

- [ ] **Step 3: Implement extension lifecycle and menu commands**

`load()` starts the server and registers “显示连接码/连接状态”; `unload()` aborts jobs, closes sockets and clears expired codes. A port conflict must produce `BRIDGE_PORT_IN_USE` in Creator Console without retrying other interfaces.

- [ ] **Step 4: Package only required runtime files**

The build script copies `source/` and the shared importer core into `dist/extension/`, writes the production package metadata, and creates the installable ZIP with Node built-ins. It must reject a package containing test fixtures, temporary output or local absolute paths.

- [ ] **Step 5: Run extension tests and inspect the ZIP**

```powershell
Set-Location tools/cocos-importer/extension
npm test
npm run build
node scripts/verify-package.mjs ../../dist/windup-cocos-importer.zip
```

Expected: the ZIP has `package.json`, `dist/main.js` and shared core only; no secrets or test output are present.

### Task 6: 实现事务写入、AssetDB 刷新和回滚

**Files:**
- Create: `tools/cocos-importer/extension/source/import-job.js`
- Create: `tools/cocos-importer/extension/source/creator-assets.js`
- Create: `tools/cocos-importer/extension/test/import-job.test.mjs`
- Create: `tools/cocos-importer/extension/test/creator-assets.test.mjs`

**Interfaces:**
- Produces: `ImportJobRunner.run({ requestId, zipBytes }): Promise<ImportResult>`。
- Produces: `CreatorAssets.refresh(dbUrl)`, `query(dbUrl)`, and `reveal(dbUrl)` adapters around `Editor.Message.request`.
- Writes only below `<project>/assets/windup-imports/` and stages below `<project>/temp/windup-importer/<requestId>/`.

- [ ] **Step 1: Write transaction and rollback tests with temporary directories**

Cover new import, replacement import, same request id, conversion failure before write, failure after backup, AssetDB refresh failure, verification failure, backup restoration and cleanup after success.

```js
await assert.rejects(() => runner.run(badRequest), /IMPORT_SHA256_MISMATCH/)
assert.equal(await readFile(existingPrefab, 'utf8'), originalPrefab)
assert.equal(await pathExists(stagingDir), false)
```

- [ ] **Step 2: Run tests and confirm the job runner is missing**

```powershell
Set-Location tools/cocos-importer/extension
node --test test/import-job.test.mjs test/creator-assets.test.mjs
```

- [ ] **Step 3: Implement strict path validation and transactional replacement**

Resolve every destination and verify it remains below the exact import root before any write, rename or removal. The rollback path may remove only the just-written pack directory recorded by the active transaction.

- [ ] **Step 4: Implement the Creator adapter against exported 3.8.8 messages**

Use the locally exported `Editor.d.ts`/Message Manager names for AssetDB refresh and query. Keep those names isolated in `creator-assets.js` so a future 3.8 patch changes one adapter rather than the import core.

- [ ] **Step 5: Run extension tests with failure injection**

```powershell
Set-Location tools/cocos-importer/extension
npm test
```

Expected: all success and rollback branches pass; no test can write outside its temporary project root.

### Task 7: Creator 3.8.8 真实 2D 验收

**Files:**
- Create: `tools/cocos-importer/test/fixtures/creator-project/package.json`
- Create: `tools/cocos-importer/test/fixtures/creator-project/settings/v2/packages/project.json`
- Create: `tools/cocos-importer/test/fixtures/creator-project/assets/.gitkeep`
- Create: `tools/cocos-importer/test/creator-runtime-check.mjs`
- Modify: `frontend/src/features/export-package/cocos-target.ts`
- Modify: `frontend/src/features/export-package/cocos-target.test.ts`
- Modify: `tools/cocos-importer/README.md`
- Modify: `frontend/src/features/export-package/README.md`

**Interfaces:**
- Fixture source: 用户提供的真实“网站看板娘-46-默认造型”帧目录。
- Expected output: 64 RGBA8 frames at 256×256; `待机` and `行走` each have 32 keys.

- [ ] **Step 1: Build the extension and install it into Creator 3.8.8**

Install `tools/cocos-importer/dist/windup-cocos-importer.zip` through Extension Manager as a global extension, enable it, and confirm `/v1/health` reports Creator 3.8.8 and the fixture project.

- [ ] **Step 2: Exercise the exact browser flow**

Run the frontend over HTTPS/dev localhost, complete pairing, click “一键导入 Cocos”, and record the returned job ID and final `db://assets/windup-imports/...prefab` URL.

- [ ] **Step 3: Verify imported assets inside Creator**

`creator-runtime-check.mjs` must assert two clips, 32 keys per clip, resolved SpriteFrame UUIDs, loop playback and stable 256×256 UITransform. Creator Console must contain no error or warning generated by the imported assets.

- [ ] **Step 4: Verify replacement and rollback in the real editor**

Import the same package again and assert only one Prefab and two clips remain. Then create a negative fixture by replacing one Prefab `__uuid__` with an unknown UUID and recomputing its package SHA-256, import it, confirm the job fails during verification, and confirm the previous playable Prefab is restored.

- [ ] **Step 5: Update user-facing documentation with verified facts only**

Set `COCOS_TARGET_READINESS.ready` to `true` and update its test only after Steps 1-4 pass. Document installation, first pairing, one-click use, permission prompt, download fallback, supported version, update behavior and uninstall procedure; remove the old “Creator 未实测/实验性” wording at the same time.

### Task 8: 最终回归、审查和交付包

**Files:**
- Modify: `.gitignore`
- Modify: `tools/cocos-importer/README.md`
- Modify: `frontend/src/features/export-package/README.md`

**Interfaces:**
- Produces: installable `windup-cocos-importer.zip` and verified web one-click flow.
- Produces: SHA-256 for the extension ZIP and the exact test command record.

- [ ] **Step 1: Remove generated test output from the tracked change set**

Ignore `tools/cocos-importer/test/.tmp-*`, extension `dist/`, Creator `library/`, `temp/`, `local/` and logs. Do not delete or modify unrelated user files.

- [ ] **Step 2: Run every repository gate**

```powershell
Set-Location frontend
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
Set-Location ../tools/cocos-importer
npm test
Set-Location extension
npm test
npm run build
```

- [ ] **Step 3: Perform security and code review**

Review loopback binding, CORS, token handling, ZIP limits, path normalization, transaction scope, log redaction and shutdown. Resolve all Critical, Important and repository-blocking findings before delivery.

- [ ] **Step 4: Verify the final diff is focused**

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: no temporary Creator project output, local paths, tokens or unrelated changes are included.

- [ ] **Step 5: Record deliverables without publishing them automatically**

Report the extension ZIP absolute path, SHA-256, supported Creator version, real-asset result, coverage result and remaining limitations. Commit or push only after the user explicitly requests it and only through the permitted fork/PR workflow.
