import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { prepareImport, validatePreparedImport } from '../src/import-core.js'
import { readStoredZip } from '../src/zip-reader.js'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '..', '..', '..')
const frontendDir = join(repoRoot, 'frontend')
const zipPath = join(frontendDir, 'dist', 'cocos-e2e', 'windup-Hero-char-42-Ranger-outfit-7.zip')

function fixtureZipBytes() {
  if (!existsSync(zipPath)) {
    execFileSync(
      'npx',
      ['vitest', 'run', '--passWithNoTests', 'src/features/export-package/cocos-target.e2e.extract.test.ts'],
      { cwd: frontendDir, stdio: 'pipe', shell: process.platform === 'win32' },
    )
  }
  return new Uint8Array(readFileSync(zipPath))
}

function centralEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = bytes.length - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1
  assert.ok(eocd >= 0)
  const total = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries = []
  for (let index = 0; index < total; index += 1) {
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    entries.push({
      centralOffset: offset,
      localOffset: view.getUint32(offset + 42, true),
      nameLength,
      compressedSize: view.getUint32(offset + 20, true),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

test('prepareImport 在内存中把 Windup ZIP 转换为完整 Cocos 文件集合', () => {
  const prepared = prepareImport(fixtureZipBytes())

  assert.equal(prepared.packFolder, 'windup-imports/Hero/Ranger')
  assert.deepEqual(prepared.summary, {
    characterName: 'Hero',
    outfitName: 'Ranger',
    animationCount: 1,
    frameCount: 3,
    fileCount: prepared.files.size,
  })
  assert.ok(prepared.files.has('windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab'))
  assert.ok(prepared.files.has('windup-imports/Hero/Ranger/animations/Walk.anim'))
  assert.doesNotThrow(() => validatePreparedImport(prepared))
})

test('validatePreparedImport 拒绝缺失 SpriteFrame 源文件的结果', () => {
  const prepared = prepareImport(fixtureZipBytes())
  const framePath = [...prepared.files.keys()].find((path) => path.endsWith('/Walk_000.png'))
  assert.ok(framePath)
  prepared.files.delete(framePath)

  assert.throws(() => validatePreparedImport(prepared), /IMPORT_OUTPUT_MISSING/)
})

test('readStoredZip 拒绝中央目录标记为符号链接的条目', () => {
  const bytes = fixtureZipBytes().slice()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = bytes.length - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1
  assert.ok(eocd >= 0)
  const centralDirectory = view.getUint32(eocd + 16, true)
  view.setUint16(centralDirectory + 4, 0x0314, true)
  view.setUint32(centralDirectory + 38, 0xa1ff0000, true)

  assert.throws(() => readStoredZip(bytes), /ZIP: 包含符号链接/)
})

test('readStoredZip 拒绝 CRC 不匹配的损坏内容', () => {
  const bytes = fixtureZipBytes().slice()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entry = centralEntries(bytes).find((candidate) => candidate.compressedSize > 0)
  assert.ok(entry)
  const localNameLength = view.getUint16(entry.localOffset + 26, true)
  const localExtraLength = view.getUint16(entry.localOffset + 28, true)
  const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength
  bytes[dataOffset] ^= 0xff
  assert.throws(() => readStoredZip(bytes), /CRC/)
})

test('readStoredZip 拒绝中央目录和本地头文件名不一致', () => {
  const bytes = fixtureZipBytes().slice()
  const entry = centralEntries(bytes)[0]
  bytes[entry.centralOffset + 46] ^= 1
  assert.throws(() => readStoredZip(bytes), /文件名不一致/)
})

test('readStoredZip 拒绝重复路径和反斜杠路径', () => {
  const original = fixtureZipBytes()
  const entries = centralEntries(original)
  const pair = entries.flatMap((first, index) =>
    entries.slice(index + 1).map((second) => [first, second]),
  ).find(([first, second]) => first.nameLength === second.nameLength)
  assert.ok(pair)

  const duplicate = original.slice()
  const [first, second] = pair
  const firstName = duplicate.slice(first.centralOffset + 46, first.centralOffset + 46 + first.nameLength)
  duplicate.set(firstName, second.centralOffset + 46)
  duplicate.set(firstName, second.localOffset + 30)
  assert.throws(() => readStoredZip(duplicate), /重复路径/)

  const backslash = original.slice()
  const slashEntry = entries.find((entry) => {
    const name = new TextDecoder().decode(backslash.slice(entry.centralOffset + 46, entry.centralOffset + 46 + entry.nameLength))
    return name.includes('/')
  })
  assert.ok(slashEntry)
  const centralSlash = backslash.indexOf('/'.charCodeAt(0), slashEntry.centralOffset + 46)
  const localSlash = backslash.indexOf('/'.charCodeAt(0), slashEntry.localOffset + 30)
  backslash[centralSlash] = '\\'.charCodeAt(0)
  backslash[localSlash] = '\\'.charCodeAt(0)
  assert.throws(() => readStoredZip(backslash), /路径不安全/)
})

test('readStoredZip 在解析前限制条目数、单条目和总解包大小', () => {
  const bytes = fixtureZipBytes()
  assert.throws(() => readStoredZip(bytes, { maxEntries: 1 }), /条目数/)
  assert.throws(() => readStoredZip(bytes, { maxEntryBytes: 1 }), /单条目/)
  assert.throws(() => readStoredZip(bytes, { maxTotalBytes: 1 }), /总解包大小/)
})

test('prepareImportFromEntries 按每次输出复制量限制重复素材引用', async () => {
  const { prepareImportFromEntries } = await import('../src/import-core.js')
  const frameCount = 65
  const manifest = {
    schema_version: 'windup-cocos-import-1.1.0',
    experimental: true,
    engine: 'cocos-creator',
    upstream_issue: 94,
    package: {
      character_id: 'c1', character_name: 'Hero', outfit_id: 'o1', outfit_name: 'Ranger',
      canvas: { w: 64, h: 64 },
    },
    master: {
      file: 'shared.png', anchor: { x: 0.5, y: 0.9 }, anchor_cocos: { x: 0.5, y: 0.1 },
    },
    actions: [{
      id: 'repeat', name: 'Repeat', export_name: 'Repeat', direction: 'default', fps: 12,
      timing_mode: 'constant-fps', loop: true, quality_status: 'passed',
      anchor: { x: 0.5, y: 0.9 }, anchor_cocos: { x: 0.5, y: 0.1 }, foot_y: 58,
      frames: Array.from({ length: frameCount }, (_, index) => ({
        index, file: 'shared.png', duration_ms: null,
      })),
      atlas: { file: 'shared.png', cols: frameCount, rows: 1, cell: { w: 64, h: 64 } },
    }],
  }
  const source = new Uint8Array(4 * 1024 * 1024)
  const entries = [
    { relativePath: 'targets/cocos-creator/cocos-import.json', data: new TextEncoder().encode(JSON.stringify(manifest)), size: 1, rootDir: 'fixture' },
    { relativePath: 'shared.png', data: source, size: source.length, rootDir: 'fixture' },
    { relativePath: 'frames/Repeat/shared.png', data: source, size: source.length, rootDir: 'fixture' },
  ]

  assert.throws(() => prepareImportFromEntries(entries), /IMPORT_OUTPUT_TOO_LARGE/)
})

test('prepareImport 为 Creator 会缓存的目录和说明文件生成稳定 meta', () => {
  const first = prepareImport(fixtureZipBytes())
  const second = prepareImport(fixtureZipBytes())
  const expected = new Map([
    [`${first.packFolder}/animations.meta`, 'directory'],
    [`${first.packFolder}/animations/Walk.meta`, 'directory'],
    [`${first.packFolder}/prefabs.meta`, 'directory'],
    [`${first.packFolder}/textures.meta`, 'directory'],
    [`${first.packFolder}/cocos-import.json.meta`, 'json'],
  ])

  for (const [path, importer] of expected) {
    assert.ok(first.files.has(path), path)
    const firstMeta = JSON.parse(new TextDecoder().decode(first.files.get(path)))
    const secondMeta = JSON.parse(new TextDecoder().decode(second.files.get(path)))
    assert.equal(firstMeta.importer, importer)
    assert.equal(firstMeta.uuid, secondMeta.uuid)
  }
})
