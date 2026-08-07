/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const playtestDirectory = fileURLToPath(new URL('.', import.meta.url))
const sourceDirectory = fileURLToPath(new URL('../../', import.meta.url))
const entitiesDirectory = fileURLToPath(new URL('../../entities/', import.meta.url))

/**
 * 依赖只向下走：pages → features → entities → shared。
 * Playtest 只读已确认的角色资产，用不到 features，因此这里连 features 一起挡住——
 * 一旦有人想在核验台里推进流程或改资产，会先在这条测试上停下来讨论，而不是默默接上去。
 */
const forbiddenLayers = ['app', 'pages', 'features'] as const

/** 架构规则：entities 统一从 `@/entities` 这一个门进，不走模块内部路径。 */
const allowedEntityEntry = '@/entities'

/** 核验台不接受随代码入库的素材：正式路径的每一帧都必须来自后端。 */
const forbiddenAssetExtensions = /\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm)$/i

function filesUnder(directory: string, keep: (name: string) => boolean): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesUnder(path, keep)
    return entry.isFile() && keep(entry.name) ? [path] : []
  })
}

function sourceFiles(): readonly string[] {
  return filesUnder(
    playtestDirectory,
    (name) => /\.(?:ts|tsx)$/.test(name) && !name.includes('.test.'),
  )
}

function moduleSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map(
    (match) => match[1] ?? '',
  )
}

/**
 * 把 `@/x` 与相对路径统一折算成相对 src 的位置。
 * 只匹配别名字面量是拦不住的：`../../../features/workflow-controller` 解析到同一个地方。
 */
function sourceEntry(file: string, dependency: string): string | null {
  const target = dependency.startsWith('@/')
    ? resolve(sourceDirectory, dependency.slice('@/'.length))
    : dependency.startsWith('.')
      ? resolve(dirname(file), dependency)
      : null
  if (target === null) return null

  const entry = relative(sourceDirectory, target)
  if (entry.startsWith('..') || isAbsolute(entry)) return null

  return entry.replaceAll('\\', '/')
}

/** 把相对路径也折算成 entities 内部路径，避免用 `../../entities/character` 绕过别名检查。 */
function entityEntry(file: string, dependency: string): string | null {
  if (dependency === allowedEntityEntry) return ''
  if (dependency.startsWith(`${allowedEntityEntry}/`)) {
    return dependency.slice(`${allowedEntityEntry}/`.length)
  }
  if (!dependency.startsWith('.')) return null

  const relativeEntry = relative(entitiesDirectory, resolve(dirname(file), dependency))
  if (relativeEntry.startsWith('..') || isAbsolute(relativeEntry)) return null

  return relativeEntry.replaceAll('\\', '/').replace(/\/index$/, '')
}

describe('Playtest 架构边界', () => {
  it('确实扫到了源码', () => {
    // 目录改名或后缀过滤写错时，下面几条会全部空跑而依然变绿。
    expect(sourceFiles().length).toBeGreaterThan(0)
  })

  it('不向上或同层依赖', () => {
    const playtestEntry = relative(sourceDirectory, playtestDirectory).replaceAll('\\', '/')

    for (const file of sourceFiles()) {
      const offenders = moduleSpecifiers(readFileSync(file, 'utf8')).filter((dependency) => {
        const entry = sourceEntry(file, dependency)
        if (entry === null) return false
        // playtest 目录内部互相引用不算跨层，它本身就在 pages 下。
        if (entry === playtestEntry.replace(/\/$/, '') || entry.startsWith(playtestEntry)) {
          return false
        }
        return forbiddenLayers.some((layer) => entry === layer || entry.startsWith(`${layer}/`))
      })

      expect(offenders, `${file} 依赖了上层或同层模块`).toEqual([])
    }
  })

  it('只从 @/entities 这一个门进业务模块', () => {
    for (const file of sourceFiles()) {
      const deepEntries = moduleSpecifiers(readFileSync(file, 'utf8'))
        .map((dependency) => ({ dependency, entry: entityEntry(file, dependency) }))
        .filter((candidate) => candidate.entry !== null && candidate.entry !== '')

      expect(
        deepEntries.map((candidate) => candidate.dependency),
        `${file} 绕过了 @/entities`,
      ).toEqual([])
    }
  })

  it('目录里不存放任何素材文件', () => {
    // 拦住把演示角色的帧图连同代码一起提交进主干的做法。
    expect(filesUnder(playtestDirectory, (name) => forbiddenAssetExtensions.test(name))).toEqual([])
  })
})
