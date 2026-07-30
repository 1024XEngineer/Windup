/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const playtestDirectory = fileURLToPath(new URL('.', import.meta.url))
const entitiesDirectory = fileURLToPath(new URL('../../entities/', import.meta.url))
const prohibitedImports = [
  'live-demo-ui-components',
  'entities/workflow-run',
  'entities/generation',
] as const
const allowedEntityImports = ['@/entities/character'] as const

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name) || entry.name.includes('.test.')) {
      return []
    }
    return [path]
  })
}

function allTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return allTypeScriptFiles(path)
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return []
    return [path]
  })
}

function moduleSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map(
    (match) => match[1] ?? '',
  )
}

function entityEntry(file: string, dependency: string): string | null {
  if (dependency === '@/entities') return ''
  if (dependency.startsWith('@/entities/')) return dependency.slice('@/entities/'.length)
  if (!dependency.startsWith('.')) return null

  const relativeEntry = relative(entitiesDirectory, resolve(dirname(file), dependency))
  if (relativeEntry.startsWith('..') || isAbsolute(relativeEntry)) return null

  return relativeEntry.replaceAll('\\', '/').replace(/\/index$/, '')
}

describe('Playtest architecture boundaries', () => {
  it('does not import forbidden application or live-demo implementation layers', () => {
    // Catches the isolated Playtest slice reaching into unrelated product layers.
    for (const file of sourceFiles(playtestDirectory)) {
      const source = readFileSync(file, 'utf8')
      for (const fragment of prohibitedImports) {
        expect(source, `${file} must not contain ${fragment}`).not.toContain(fragment)
      }
    }
  })

  it('does not import application or capabilities roots or subpaths', () => {
    // Catches bypassing the isolated Page through either a barrel or a deep implementation path.
    for (const file of sourceFiles(playtestDirectory)) {
      const dependencies = moduleSpecifiers(readFileSync(file, 'utf8'))
      expect(
        dependencies.filter(
          (dependency) =>
            dependency === '@/application' ||
            dependency.startsWith('@/application/') ||
            dependency === '@/capabilities' ||
            dependency.startsWith('@/capabilities/'),
        ),
        `${file} must not import application or capabilities`,
      ).toEqual([])
    }
  })

  it('imports Entity contracts only from the two approved direct entrypoints', () => {
    // Catches alias or relative root barrels and deep paths that hide Playtest's dependencies.
    for (const file of sourceFiles(playtestDirectory)) {
      const entityImports = moduleSpecifiers(readFileSync(file, 'utf8'))
        .map((dependency) => ({ dependency, entry: entityEntry(file, dependency) }))
        .filter((candidate) => candidate.entry !== null)

      for (const { dependency, entry } of entityImports) {
        expect(allowedEntityImports, `${file} imports ${dependency}`).toContain(
          `@/entities/${entry}`,
        )
      }
    }
  })

  it('keeps the demo fixture out of formal Playtest source', () => {
    // Catches a formal route silently importing the demo character as an API fallback.
    const importers = allTypeScriptFiles(playtestDirectory).filter((file) =>
      readFileSync(file, 'utf8').includes('testing/demo-character'),
    )

    expect(
      importers.every(
        (file) => file === join(playtestDirectory, 'demo-page.tsx') || file.includes('.test.'),
      ),
    ).toBe(true)
    expect(readFileSync(join(playtestDirectory, 'index.tsx'), 'utf8')).not.toContain(
      'testing/demo-character',
    )
  })
})
