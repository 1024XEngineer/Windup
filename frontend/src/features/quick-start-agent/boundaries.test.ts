import { readFileSync, readdirSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const featureDirectory = resolve(import.meta.dirname)
const quickStartPageDirectory = resolve(import.meta.dirname, '../../pages/quick-start')

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionFiles(path)
    if (!['.ts', '.tsx'].includes(extname(entry.name)) || entry.name.includes('.test.')) return []
    return [path]
  })
}

function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/gu)].map((match) => match[2]!)
}

describe('quick-start-agent architecture boundary', () => {
  it('keeps business imports out of the Agent core', () => {
    const forbidden = ['@/pages', '@/entities', '@/shared/api', '@/features']
    const featureDependencies = productionFiles(featureDirectory)
      .filter((file) => basename(file) !== 'production.ts')
      .flatMap((file) => moduleSpecifiers(readFileSync(file, 'utf8')))

    expect(
      featureDependencies.filter((dependency) =>
        forbidden.some((prefix) => dependency === prefix || dependency.startsWith(`${prefix}/`)),
      ),
    ).toEqual([])
  })

  it('keeps prompts, Tool schema, and SDK runtime out of the page directory', () => {
    const pageSource = productionFiles(quickStartPageDirectory)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    expect(pageSource).not.toContain('start_character_generation')
    expect(pageSource).not.toContain('generateText(')
    expect(pageSource).not.toContain('quickStartPlannerInstructions')
  })
})
