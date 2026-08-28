import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { ImportJobRunner } from '../source/import-job.js'

const roots = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(overrides = {}) {
  const projectPath = await mkdtemp(join(tmpdir(), 'windup-cocos-job-'))
  roots.push(projectPath)
  const calls = []
  const assets = {
    async refresh(dbUrl) {
      calls.push(['refresh', dbUrl])
    },
    async query(dbUrl) {
      calls.push(['query', dbUrl])
      return { uuid: `uuid-${calls.length}`, url: dbUrl }
    },
    async reveal(dbUrl) {
      calls.push(['reveal', dbUrl])
    },
    ...overrides.assets,
  }
  const prepared = {
    packFolder: 'windup-imports/Hero/Ranger',
    files: new Map([
      ['windup-imports/Hero/Ranger/animations/Walk.anim', new TextEncoder().encode('animation')],
      ['windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab', new TextEncoder().encode('prefab')],
    ]),
    plan: {
      animations: [{ name: 'Walk' }],
      prefab: { cocosPath: 'windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab' },
    },
    summary: { animationCount: 1, frameCount: 3 },
    ...overrides.prepared,
  }
  let prepares = 0
  const runner = new ImportJobRunner({
    projectPath,
    assets,
    fileSystem: overrides.fileSystem,
    prepareImport: () => {
      prepares += 1
      if (overrides.prepareError) throw overrides.prepareError
      return prepared
    },
  })
  return { projectPath, calls, runner, prepared, prepares: () => prepares }
}

function request(bytes = new TextEncoder().encode('zip')) {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    zipBytes: bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

test('ImportJobRunner writes, refreshes, verifies and reveals a new import', async () => {
  const { projectPath, calls, runner } = await fixture()
  const phases = []
  const result = await runner.run({ ...request(), onPhase: (phase) => phases.push(phase) })

  assert.equal(
    await readFile(join(projectPath, 'assets/windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab'), 'utf8'),
    'prefab',
  )
  assert.deepEqual(phases, ['converting', 'writing', 'refreshing', 'verifying'])
  assert.equal(result.dbUrl, 'db://assets/windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab')
  assert.equal(result.animationCount, 1)
  assert.deepEqual(calls.at(-1), ['reveal', result.dbUrl])
  assert.equal(existsSync(join(projectPath, 'temp/windup-importer')), false)
})

test('ImportJobRunner returns the same promise for a duplicate request id', async () => {
  const context = await fixture()
  const first = context.runner.run(request())
  const second = context.runner.run(request())
  assert.equal(first, second)
  assert.deepEqual(await second, await first)
  assert.equal(context.prepares(), 1)
})

test('ImportJobRunner rejects digest mismatch before conversion or disk writes', async () => {
  const context = await fixture()
  await assert.rejects(
    () => context.runner.run({ ...request(), sha256: '0'.repeat(64) }),
    /IMPORT_SHA256_MISMATCH/,
  )
  assert.equal(context.prepares(), 0)
  assert.equal(existsSync(join(context.projectPath, 'assets')), false)
})

test('ImportJobRunner rejects a prepared path outside assets/windup-imports', async () => {
  const context = await fixture({
    prepared: {
      packFolder: '../escape',
      files: new Map([['../escape/p.prefab', new TextEncoder().encode('bad')]]),
      plan: { animations: [], prefab: { cocosPath: '../escape/p.prefab' } },
    },
  })
  await assert.rejects(() => context.runner.run(request()), /IMPORT_PATH_FORBIDDEN/)
  assert.equal(existsSync(join(context.projectPath, 'escape')), false)
})

test('ImportJobRunner restores an existing pack when AssetDB refresh fails', async () => {
  let refreshes = 0
  const context = await fixture({
    assets: {
      async refresh() {
        refreshes += 1
        if (refreshes === 1) throw new Error('refresh failed')
      },
    },
  })
  const oldPrefab = join(context.projectPath, 'assets/windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab')
  await mkdir(join(oldPrefab, '..'), { recursive: true })
  await writeFile(oldPrefab, 'original prefab')

  await assert.rejects(
    () => context.runner.run(request()),
    (error) => error.code === 'IMPORT_FAILED' && error.rolledBack === true,
  )
  assert.equal(await readFile(oldPrefab, 'utf8'), 'original prefab')
  assert.equal(refreshes, 2)
  assert.equal(existsSync(join(context.projectPath, 'temp/windup-importer')), false)
})

test('ImportJobRunner removes a new pack when verification fails', async () => {
  const context = await fixture({ assets: { query: async () => null } })
  await assert.rejects(
    () => context.runner.run(request()),
    (error) => error.code === 'IMPORT_VERIFY_FAILED' && error.rolledBack === true,
  )
  assert.equal(existsSync(join(context.projectPath, 'assets/windup-imports/Hero/Ranger')), false)
  assert.equal(existsSync(join(context.projectPath, 'temp/windup-importer')), false)
})

test('ImportJobRunner reports rollback failure without skipping transaction cleanup', async () => {
  const context = await fixture({
    assets: { query: async () => null },
    fileSystem: {
      async rm(path, options) {
        if (path.endsWith(join('Hero', 'Ranger'))) throw new Error('private disk path')
        return rm(path, options)
      },
    },
  })

  await assert.rejects(
    () => context.runner.run(request()),
    (error) => error.code === 'IMPORT_ROLLBACK_FAILED' && error.rolledBack === false,
  )
  assert.equal(existsSync(join(context.projectPath, 'temp/windup-importer')), false)
})

test('ImportJobRunner rejects a symlinked import root before writing outside the project', async () => {
  const context = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'windup-cocos-outside-'))
  roots.push(outside)
  await mkdir(join(context.projectPath, 'assets'), { recursive: true })
  await symlink(
    outside,
    join(context.projectPath, 'assets/windup-imports'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  await assert.rejects(() => context.runner.run(request()), /IMPORT_PATH_SYMLINK/)
  assert.equal(existsSync(join(outside, 'Hero/Ranger')), false)
})
