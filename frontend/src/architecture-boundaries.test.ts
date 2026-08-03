/// <reference types="node" />

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = `${root}/${name}`
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

function importsFrom(source: string, layer: string): boolean {
  return new RegExp(`from ['"]@/${layer}(?:/|['"])`).test(source)
}

function layerViolations(layer: string, forbidden: string[]): string[] {
  return sourceFiles(`${SRC}/${layer}`)
    .filter((path) => {
      const source = readFileSync(path, 'utf8')
      return forbidden.some((dependency) => importsFrom(source, dependency))
    })
    .map((path) => relative(SRC, path))
}

describe('frontend architecture boundaries', () => {
  it('allows dependencies only toward lower layers', () => {
    expect(layerViolations('shared', ['entities', 'features', 'pages', 'app'])).toEqual([])
    expect(layerViolations('entities', ['features', 'pages', 'app'])).toEqual([])
    expect(layerViolations('features', ['pages', 'app'])).toEqual([])
    expect(layerViolations('pages', ['app'])).toEqual([])
  })

  it('keeps transport calls out of pages and features', () => {
    const violations = ['pages', 'features'].flatMap((layer) =>
      sourceFiles(`${SRC}/${layer}`)
        .filter((path) => /\bfetch\s*\(/.test(readFileSync(path, 'utf8')))
        .map((path) => relative(SRC, path)),
    )

    expect(violations).toEqual([])
  })

  it('uses the public entities entrypoint outside the entities layer', () => {
    const violations = sourceFiles(SRC)
      .filter((path) => !path.includes('/entities/'))
      .filter((path) => /from ['"]@\/entities\//.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path))

    expect(violations).toEqual([])
  })
})
