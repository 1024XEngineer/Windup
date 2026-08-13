import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const productColorConsumers = [
  '../../app/layout/app-header.tsx',
  '../../app/layout/page-back-button.tsx',
  '../../pages/workspace/index.tsx',
  '../../pages/workspace/workspace.css',
  '../../pages/account/index.tsx',
  '../../pages/account/account.css',
  '../../pages/projects/index.tsx',
  '../../pages/project-create/index.tsx',
  '../../pages/project-detail/index.tsx',
  '../../pages/asset-library/index.tsx',
  '../../pages/character-detail/index.tsx',
  '../../pages/quick-start/index.tsx',
  '../../pages/workflow-editor/index.tsx',
  '../../pages/workflow-editor/workflow-editor.css',
  '../../pages/playtest/entry.tsx',
  '../../pages/playtest/index.tsx',
  '../../pages/playtest/workbench/index.tsx',
  './pagination.tsx',
]

const builtInPaletteUtility =
  /(?:bg|text|border|outline|decoration|placeholder|from|via|to)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b/

describe('product color system', () => {
  it('defines one semantic palette for authenticated product pages', () => {
    const theme = source('../../index.css')

    for (const token of [
      '--color-app-canvas:',
      '--color-app-surface:',
      '--color-app-surface-muted:',
      '--color-app-ink:',
      '--color-app-muted:',
      '--color-app-line:',
      '--color-app-accent:',
      '--color-app-accent-soft:',
      '--color-app-danger:',
      '--color-app-warning:',
      '--color-app-info:',
    ]) {
      expect(theme, token).toContain(token)
    }
  })

  it('keeps the four product pages on shared semantic colors', () => {
    for (const path of productColorConsumers) {
      const content = source(path)
      expect(content, `${path} contains a private color value`).not.toMatch(
        /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i,
      )
      expect(content, `${path} declares or consumes a page-owned palette`).not.toMatch(
        /--(?:editor|account)-/,
      )
      expect(content, `${path} bypasses the product palette`).not.toMatch(builtInPaletteUtility)
    }
  })

  it('uses the shared canvas for full-page product backgrounds', () => {
    for (const path of [
      '../../pages/quick-start/index.tsx',
      '../../pages/project-create/index.tsx',
      '../../pages/project-detail/index.tsx',
    ]) {
      expect(source(path), `${path} does not consume the shared canvas`).toContain('bg-app-canvas')
    }
  })
})
