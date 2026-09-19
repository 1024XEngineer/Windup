// E2E:真的跑 CLI 走完整 ZIP → 输出目录 → 校验内容
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, rmSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 真正生成的 ZIP 在 frontend/dist/cocos-e2e/ 下面(由 vitest e2e 测试产出)。
// 这里直接 fork 一个子进程跑 vitest 产出 ZIP,确保 e2e 自包含。
const repoRoot = resolve(__dirname, '..', '..', '..')
const frontendDir = join(repoRoot, 'frontend')
const zipPath = join(frontendDir, 'dist', 'cocos-e2e', 'windup-Hero-char-42-Ranger-outfit-7.zip')
const outDir = join(__dirname, '.tmp-cli-out')
const framesPackageRoot = join(__dirname, '.tmp-frames-package')

function ensureZip() {
  if (existsSync(zipPath)) return
  // 用 vitest 跑一次 extract test 落盘
  const command = process.platform === 'win32' ? 'cmd' : 'npx'
  const commandArgs = process.platform === 'win32'
    ? ['/c', 'npx', 'vitest', 'run', '--passWithNoTests', 'src/features/export-package/cocos-target.e2e.extract.test.ts']
    : ['vitest', 'run', '--passWithNoTests', 'src/features/export-package/cocos-target.e2e.extract.test.ts']
  execFileSync(
    command,
    commandArgs,
    { cwd: frontendDir, stdio: 'inherit' },
  )
  if (!existsSync(zipPath)) throw new Error(`vitest 跑完也没产出 ZIP: ${zipPath}`)
}

test('CLI 把 ZIP 解析 + 写到指定目录', () => {
  ensureZip()
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const cliPath = join(repoRoot, 'tools', 'cocos-importer', 'bin', 'windup-cocos-import.mjs')
  execFileSync('node', [cliPath, zipPath, '--out', outDir, '--force'], {
    stdio: 'pipe',
    cwd: repoRoot,
  })

  // 检查输出结构
  const packRoot = join(outDir, 'windup-imports', 'Hero', 'Ranger')
  assert.ok(existsSync(packRoot), `缺包根: ${packRoot}`)
  assert.ok(existsSync(join(packRoot, 'cocos-import.json')))
  assert.ok(existsSync(join(packRoot, 'textures')))

  // master.png 应该被拷到 textures/<character>-master.png
  const masterFile = readdirSync(join(packRoot, 'textures')).find((n) => n.endsWith('.png'))
  assert.ok(masterFile, 'master.png 没出现在 textures 目录')

  // 至少一个动作的纹理目录
  const animDir = join(packRoot, 'animations', 'Walk')
  assert.ok(existsSync(animDir), `缺动画目录: ${animDir}`)
  const frames = readdirSync(animDir)
  const framePngs = frames.filter((f) => f.endsWith('.png'))
  assert.ok(framePngs.length >= 4, `期望至少 4 张 PNG(3 帧 + 1 atlas),实际 ${framePngs.length}`)

  // 至少一个 .prefab
  const prefabDir = join(packRoot, 'prefabs')
  assert.ok(existsSync(prefabDir), '缺 prefabs 目录')
  const prefabFiles = readdirSync(prefabDir).filter((f) => f.endsWith('.prefab'))
  assert.equal(prefabFiles.length, 1)

  // .prefab 是合法 JSON
  const prefabContent = readFileSync(join(prefabDir, prefabFiles[0]), 'utf-8')
  const prefabJson = JSON.parse(prefabContent)
  const prefabAsset = Array.isArray(prefabJson) ? prefabJson[0] : prefabJson
  assert.equal(prefabAsset.__type__, 'cc.Prefab')
  assert.ok(Array.isArray(prefabJson), 'Cocos Creator 3.x prefab 应使用对象数组序列化')
  assert.equal(prefabAsset.data.__id__, 1)

  // cocos-import.json 副本存在
  const manifest = JSON.parse(readFileSync(join(packRoot, 'cocos-import.json'), 'utf-8'))
  assert.equal(manifest.engine, 'cocos-creator')
})

test('CLI --dry-run 不写任何文件', () => {
  ensureZip()
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })

  const cliPath = join(repoRoot, 'tools', 'cocos-importer', 'bin', 'windup-cocos-import.mjs')
  execFileSync('node', [cliPath, zipPath, '--out', outDir, '--dry-run'], {
    stdio: 'pipe',
    cwd: repoRoot,
  })
  assert.equal(existsSync(outDir), false, 'dry-run 不应创建输出目录')
})

test('CLI 允许直接选择旧资产包的 frames 目录', () => {
  if (existsSync(framesPackageRoot)) rmSync(framesPackageRoot, { recursive: true, force: true })
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })

  const framesDir = join(framesPackageRoot, 'frames')
  const idleDir = join(framesDir, '待机')
  mkdirSync(idleDir, { recursive: true })
  mkdirSync(join(framesPackageRoot, 'character'), { recursive: true })
  mkdirSync(join(framesPackageRoot, 'atlas'), { recursive: true })

  const masterBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01])
  const frameBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02])
  const atlasBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03])
  writeFileSync(join(framesPackageRoot, 'character', 'master.png'), masterBytes)
  writeFileSync(join(idleDir, '待机_000.png'), frameBytes)
  writeFileSync(join(framesPackageRoot, 'atlas', '待机.png'), atlasBytes)
  writeFileSync(
    join(framesPackageRoot, 'meta.json'),
    JSON.stringify({
      character: { id: '46', name: '网站看板娘', image: 'character/master.png' },
      outfit: { id: 'default', name: '默认造型' },
      canvas: { w: 1, h: 1 },
      actions: [
        {
          id: 'idle',
          name: '待机',
          fps: 12,
          loop: true,
          anchor: { x: 0.5, y: 0.92 },
          frames: [{ index: 0, file: '待机_000.png' }],
          atlas: { file: 'atlas/待机.png', cols: 1, rows: 1, cell: { w: 1, h: 1 } },
        },
      ],
    }),
  )

  try {
    const cliPath = join(repoRoot, 'tools', 'cocos-importer', 'bin', 'windup-cocos-import.mjs')
    execFileSync('node', [cliPath, framesDir, '--out', outDir, '--force'], {
      stdio: 'pipe',
      cwd: repoRoot,
    })

    const packRoot = join(outDir, 'windup-imports', '网站看板娘', '默认造型')
    assert.deepEqual(
      readFileSync(join(packRoot, 'animations', '待机', '待机_000.png')),
      frameBytes,
      '导出的动画帧必须来自用户选中的 frames 目录',
    )
  } finally {
    if (existsSync(framesPackageRoot)) rmSync(framesPackageRoot, { recursive: true, force: true })
  }
})

test('CLI 拒绝不存在的输入文件', () => {
  const cliPath = join(repoRoot, 'tools', 'cocos-importer', 'bin', 'windup-cocos-import.mjs')
  let exitCode = 0
  try {
    execFileSync('node', [cliPath, join(__dirname, '.tmp-does-not-exist.zip'), '--out', outDir], {
      stdio: 'pipe',
    })
  } catch (err) {
    exitCode = err.status
  }
  assert.notEqual(exitCode, 0, '不存在的文件应让 CLI 退出非 0')
})

test('CLI 拒绝会覆盖仓库根目录的输出路径', () => {
  ensureZip()
  const cliPath = join(repoRoot, 'tools', 'cocos-importer', 'bin', 'windup-cocos-import.mjs')
  let exitCode = 0
  try {
    execFileSync('node', [cliPath, zipPath, '--out', repoRoot, '--force'], { stdio: 'pipe' })
  } catch (err) {
    exitCode = err.status
  }
  assert.notEqual(exitCode, 0, '仓库根目录不应成为可递归删除的输出目录')
})

test('CLI 拒绝没有 manifest 的 ZIP', () => {
  // 造一个最小 STORED ZIP,只有一个 README,没 manifest
  const fakeZip = join(__dirname, '.tmp-no-manifest.zip')
  const innerName = 'README.md'
  const innerData = Buffer.from('# not a windup package\n')

  // 手工拼一个 stored ZIP
  const lh = Buffer.alloc(30)
  const nameBuf = Buffer.from(innerName, 'utf-8')
  lh.writeUInt32LE(0x04034b50, 0)
  lh.writeUInt16LE(20, 4) // version
  lh.writeUInt16LE(0, 6) // flags
  lh.writeUInt16LE(0, 8) // method = stored
  lh.writeUInt16LE(0, 10) // mtime
  lh.writeUInt16LE(0, 12) // mdate
  lh.writeUInt32LE(0, 14) // crc
  lh.writeUInt32LE(innerData.length, 18) // csize
  lh.writeUInt32LE(innerData.length, 22) // usize
  lh.writeUInt16LE(nameBuf.length, 26)
  lh.writeUInt16LE(0, 28) // extra

  const cdh = Buffer.alloc(46)
  cdh.writeUInt32LE(0x02014b50, 0)
  cdh.writeUInt16LE(20, 4) // version made by
  cdh.writeUInt16LE(20, 6) // version needed
  cdh.writeUInt16LE(0, 8)
  cdh.writeUInt16LE(0, 10) // method
  cdh.writeUInt16LE(0, 12) // mtime
  cdh.writeUInt16LE(0, 14) // mdate
  cdh.writeUInt32LE(0, 16) // crc
  cdh.writeUInt32LE(innerData.length, 20) // csize
  cdh.writeUInt32LE(innerData.length, 24) // usize
  cdh.writeUInt16LE(nameBuf.length, 28)
  cdh.writeUInt16LE(0, 30) // extra
  cdh.writeUInt16LE(0, 32) // comment
  cdh.writeUInt16LE(0, 34) // disk
  cdh.writeUInt16LE(0, 36) // int attrs
  cdh.writeUInt32LE(0, 38) // ext attrs
  cdh.writeUInt32LE(0, 42) // local header offset

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8) // entries on this disk
  eocd.writeUInt16LE(1, 10) // total entries
  eocd.writeUInt32LE(46, 12) // cd size
  eocd.writeUInt32LE(30 + nameBuf.length + innerData.length, 16) // cd offset
  eocd.writeUInt16LE(0, 20)

  writeFileSync(
    fakeZip,
    Buffer.concat([lh, nameBuf, innerData, cdh, eocd]),
  )
  try {
    const cliPath = join(repoRoot, 'tools', 'cocos-importer', 'bin', 'windup-cocos-import.mjs')
    let exitCode = 0
    try {
      execFileSync('node', [cliPath, fakeZip, '--out', outDir], { stdio: 'pipe' })
    } catch (err) {
      exitCode = err.status
    }
    assert.notEqual(exitCode, 0, '没有 manifest 的 ZIP 应让 CLI 退出非 0')
  } finally {
    if (existsSync(fakeZip)) {
      try { unlinkSync(fakeZip) } catch {}
    }
  }
})
