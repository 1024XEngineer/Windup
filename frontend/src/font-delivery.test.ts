import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'
import { build } from 'vite'

const buildDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    buildDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('production serif font delivery', () => {
  it('ships one same-origin WOFF2 family for every serif entry point', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'windup-font-delivery-'))
    buildDirectories.push(outDir)

    await build({
      build: { emptyOutDir: true, outDir },
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      logLevel: 'silent',
      root: fileURLToPath(new URL('..', import.meta.url)),
    })

    const assetNames = await readdir(join(outDir, 'assets'))
    const cssNames = assetNames.filter((name) => name.endsWith('.css'))
    const css = (
      await Promise.all(cssNames.map((name) => readFile(join(outDir, 'assets', name), 'utf8')))
    ).join('\n')

    expect(assetNames.some((name) => name.endsWith('.woff2'))).toBe(true)
    expect(css).toContain('@font-face')
    expect(css).toContain('font-family:Noto Serif SC Variable')
    expect(css).toContain('font-display:swap')
    expect(css).toContain('unicode-range:')
    expect(css).toContain('--font-serif:"Noto Serif SC Variable", serif')
    expect(css).toContain('.font-serif{font-family:var(--font-serif)}')
    expect(css).not.toMatch(/Songti SC|Noto Serif CJK SC|STSong|Georgia|Times New Roman/)
  }, 15_000)
})
