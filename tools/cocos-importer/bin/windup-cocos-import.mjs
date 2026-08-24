#!/usr/bin/env node
// CLI:把 Windup 导出的 windup-*.zip 解到指定目录,产出按 Cocos Creator 结构
// 组织的资源目录 + 元数据文件,供真实 Creator 实例继续验收。
//
// 用法:
//   node tools/cocos-importer/bin/windup-cocos-import.mjs <input.zip> --out <dir>
//   node tools/cocos-importer/bin/windup-cocos-import.mjs <input.zip>             # 默认 out=./cocos-import-output
//   node tools/cocos-importer/bin/windup-cocos-import.mjs <input.zip> --out <dir> --dry-run

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  statSync,
  realpathSync,
  readdirSync,
} from 'node:fs'
import { resolve, dirname, basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { prepareImport, prepareImportFromEntries } from '../src/import-core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { input: null, out: null, dryRun: false, force: false }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--out' || a === '-o') {
      args.out = argv[++i]
    } else if (a === '--dry-run') {
      args.dryRun = true
    } else if (a === '--force') {
      args.force = true
    } else if (a === '--help' || a === '-h') {
      args.help = true
    } else if (!args.input) {
      args.input = a
    }
  }
  if (!args.out) args.out = resolve(process.cwd(), 'cocos-import-output')
  return args
}

function canonicalPath(path) {
  if (existsSync(path)) return realpathSync.native(path)
  const parent = dirname(path)
  if (parent === path) return path
  return join(canonicalPath(parent), basename(path))
}

function isSameOrAncestor(parent, child) {
  const relativePath = resolve(parent) === resolve(child) ? '' : relative(parent, child)
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.includes(':'))
}

function assertSafeOutputDir(outDir, inputPath) {
  const output = canonicalPath(outDir)
  const repoRoot = canonicalPath(resolve(__dirname, '..', '..', '..'))
  const inputDir = canonicalPath(dirname(inputPath))
  const forbiddenAncestors = [
    ['仓库根目录或其祖先', repoRoot],
    ['输入资产所在目录或其祖先', inputDir],
  ]
  for (const [label, forbidden] of forbiddenAncestors) {
    if (isSameOrAncestor(output, forbidden)) {
      throw new Error(`拒绝危险输出目录: ${outDir} 是${label}`)
    }
  }
}

function readFramesDirectory(framesDir) {
  if (basename(framesDir).toLowerCase() !== 'frames') {
    throw new Error(`目录输入必须指向名为 frames 的逐帧目录: ${framesDir}`)
  }
  const packageRoot = dirname(framesDir)
  const legacyMetaPath = join(packageRoot, 'meta.json')
  if (!existsSync(legacyMetaPath)) {
    throw new Error(`frames 同级资产包缺少 meta.json: ${legacyMetaPath}`)
  }

  const rootDir = basename(packageRoot)
  const entries = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`frames 资产包不允许符号链接: ${fullPath}`)
      }
      if (entry.isDirectory()) {
        visit(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const data = readFileSync(fullPath)
      entries.push({
        rootDir,
        relativePath: relative(packageRoot, fullPath).replaceAll('\\', '/'),
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        size: data.length,
      })
    }
  }
  visit(packageRoot)
  return entries
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`Windup → Cocos Creator CLI 导入器

用法:
  node tools/cocos-importer/bin/windup-cocos-import.mjs <input.zip|frames目录> [--out <dir>] [--dry-run]

参数:
  <input>          Windup 导出的 ZIP,或已解压资产包内的 frames 目录
  --out <dir>      输出目录(默认 ./cocos-import-output)
  --dry-run        只打印计划,不写文件
  --force          允许删除并重建已存在的输出目录
  -h, --help       显示本帮助

产物:
  <out>/<packFolder>/...
    textures/        主母版 PNG
    animations/<action>/<action>_NNN.png  每张帧 + atlas.png
    prefabs/<name>.prefab + .meta
    cocos-import.json  原始 manifest 副本
    <pack>.meta.json   导入元信息

输出目录按 Cocos Creator 3.8.x 资产结构生成,可复制到工程的 assets/ 下。
日常一键导入请安装 tools/cocos-importer/dist/windup-cocos-importer.zip。
`)
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.input) {
    printHelp()
    process.exit(args.help ? 0 : 2)
  }

  const inputPath = resolve(process.cwd(), args.input)
  if (!existsSync(inputPath)) {
    throw new Error(`输入文件不存在: ${inputPath}`)
  }
  const stat = statSync(inputPath)
  let prepared
  if (stat.isFile()) {
    const bytes = readFileSync(inputPath)
    const stored = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // eslint-disable-next-line no-console
    console.log(`读取 ZIP: ${basename(inputPath)} (${stored.length} bytes)`)
    prepared = prepareImport(stored)
  } else if (stat.isDirectory()) {
    const flat = readFramesDirectory(inputPath)
    // eslint-disable-next-line no-console
    console.log(`读取 frames 目录: ${inputPath} (${flat.length} 个文件)`)
    prepared = prepareImportFromEntries(flat)
  } else {
    throw new Error(`输入既不是 ZIP 文件也不是 frames 目录: ${inputPath}`)
  }

  const { manifest, plan } = prepared
  // eslint-disable-next-line no-console
  console.log(
    `  manifest: schema=${manifest.schema_version} char=${manifest.package.character_name} ` +
      `outfit=${manifest.package.outfit_name} actions=${manifest.actions.length}`,
  )

  // eslint-disable-next-line no-console
  console.log(`  计划: ${plan.spriteFrames.length} 个 SpriteFrame,${plan.animations.length} 个动画`)

  const outDir = resolve(process.cwd(), args.out)
  assertSafeOutputDir(outDir, inputPath)

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(`\n[dry-run] 不会写任何文件,仅打印计划:`)
    // eslint-disable-next-line no-console
    console.log(`  out dir: ${outDir}`)
    // eslint-disable-next-line no-console
    console.log(`  textures: ${plan.spriteFrames.filter((s) => s.sourcePath.startsWith('character/')).length}`)
    // eslint-disable-next-line no-console
    console.log(
      `  animations: ${plan.spriteFrames.filter((s) => s.sourcePath.startsWith('frames/') || s.sourcePath.startsWith('atlas/')).length}`,
    )
    // eslint-disable-next-line no-console
    console.log(`  prefabs: 1 (${plan.prefab.cocosPath})`)
    return
  }

  if (existsSync(outDir) && !args.force) {
    throw new Error(`输出目录已存在: ${outDir};如需覆盖请显式传 --force`)
  }
  if (existsSync(outDir) && !statSync(outDir).isDirectory()) {
    throw new Error(`输出路径不是目录: ${outDir}`)
  }
  if (existsSync(outDir)) {
    // eslint-disable-next-line no-console
    console.log(`  清空已存在输出: ${outDir}`)
    rmSync(outDir, { recursive: true, force: true })
  }
  mkdirSync(outDir, { recursive: true })

  let writtenBytes = 0
  let fileCount = 0
  for (const [path, bytes] of prepared.files) {
    const dst = join(outDir, path)
    mkdirSync(dirname(dst), { recursive: true })
    writeFileSync(dst, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    writtenBytes += bytes.length
    fileCount += 1
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n已写入 ${fileCount} 个文件,共 ${writtenBytes} bytes 到:\n  ${outDir}\n\n` +
      `下一步:将 "${plan.packFolder}" 目录复制到 Cocos Creator 工程的 assets/ 下,` +
      `再用 Creator 实例完成导入与播放验收。`,
  )
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[error] ${err instanceof Error ? err.stack || err.message : String(err)}`)
  process.exit(1)
})
