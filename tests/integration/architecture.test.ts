import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * 依赖边界自动检查。
 *
 * 用 TypeScript AST 而不是正则：同时覆盖单/双引号、import、export-from 和
 * 字符串形式的 dynamic import；别名与相对路径都按真实目标判断。
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../frontend/src')

/** 每层允许 import 的层。 */
const ALLOWED: Record<string, string[]> = {
  app: ['pages', 'features', 'capabilities', 'entities', 'shared'],
  pages: ['features', 'capabilities', 'entities', 'shared'],
  features: ['capabilities', 'entities', 'shared'],
  capabilities: ['entities', 'shared'],
  entities: ['shared'],
  shared: [],
}

/** 这三层的不同 Slice 不得互相引用。entities 已选择作为一个整体模块。 */
const ISOLATED_SLICE_LAYERS = new Set(['pages', 'features', 'capabilities'])

/** 跨层引用时，这些层以第二段目录作为公开入口根。 */
const PUBLIC_SLICE_LAYERS = new Set(['pages', 'features', 'capabilities', 'entities', 'shared'])

/** 全局审计后的一级模块清单；新增目录必须先说明归属并更新这里。 */
const DECLARED_SLICES = {
  pages: [
    'asset-library',
    'home',
    'not-found',
    'playtest',
    'project-detail',
    'projects',
    'quick-start',
    'workflow-editor',
  ],
  features: ['character-setup', 'export', 'generation', 'quick-start', 'review'],
  capabilities: ['image-generation', 'image-upload'],
  entities: [
    'action-template',
    'character',
    'project',
    'provider-session',
    'task',
    'wearable',
    'workflow-run',
  ],
  shared: ['api', 'hooks', 'pagination', 'ui'],
} as const

const PAGE_MODULE_ROOTS = [
  'pages/workflow-editor/editor',
  'pages/playtest/inspection-preview',
]

function relativeSrc(file: string): string {
  return relative(SRC, file).replaceAll('\\', '/')
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

interface SourceLocation {
  layer: string | null
  slice: string | null
}

interface TargetLocation {
  layer: string
  slice: string
  rest: string[]
}

interface Violation {
  file: string
  specifier: string
  reason: string
}

function sourceLocation(file: string): SourceLocation {
  const parts = relativeSrc(file).split('/')
  const layer = ALLOWED[parts[0]] ? parts[0] : null
  if (!layer) return { layer: null, slice: null }
  return {
    layer,
    slice: ISOLATED_SLICE_LAYERS.has(layer) ? (parts[1] ?? null) : layer,
  }
}

function targetLocation(file: string, specifier: string): TargetLocation | null {
  let parts: string[]
  if (specifier.startsWith('@/')) {
    parts = specifier.slice(2).split('/')
  } else if (specifier.startsWith('.')) {
    const target = resolve(dirname(file), specifier)
    const rel = relativeSrc(target)
    if (rel.startsWith('..')) return null
    parts = rel.split('/')
  } else {
    return null
  }

  const layer = parts[0]
  if (!ALLOWED[layer]) return null
  return {
    layer,
    slice: PUBLIC_SLICE_LAYERS.has(layer) ? (parts[1] ?? '') : layer,
    rest: PUBLIC_SLICE_LAYERS.has(layer) ? parts.slice(2) : parts.slice(1),
  }
}

function targetRelativePath(file: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2)
  if (!specifier.startsWith('.')) return null
  const rel = relativeSrc(resolve(dirname(file), specifier))
  return rel.startsWith('..') ? null : rel
}

function capabilityMockViolation(file: string, specifier: string): Violation | null {
  const source = relativeSrc(file)
  if (/\.test\.tsx?$/.test(source) || source === 'app/composition/development.ts') return null

  const target = targetRelativePath(file, specifier)
  if (!target || !/(?:^|\/)(?:adapters\/)?mocks?(?:\/|$)/.test(target)) {
    return null
  }

  return {
    file: source,
    specifier,
    reason: '生产代码不得直接选择能力 Mock Adapter',
  }
}

function moduleSpecifiers(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found: string[] = []

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function violationFor(file: string, specifier: string): Violation | null {
  const rel = relativeSrc(file)
  const source = sourceLocation(file)
  const mockViolation = capabilityMockViolation(file, specifier)
  if (mockViolation) return mockViolation

  if (
    (rel.startsWith('pages/workflow-editor/editor/') ||
      rel.startsWith('pages/playtest/inspection-preview/')) &&
    (specifier === 'react-router' || specifier === 'react-router-dom')
  ) {
    return { file: rel, specifier, reason: '页面内模块不得读 Router' }
  }

  const target = targetLocation(file, specifier)
  if (!target) return null

  const targetRel = targetRelativePath(file, specifier)
  for (const moduleRoot of PAGE_MODULE_ROOTS) {
    const sourceInsideModule = rel.startsWith(`${moduleRoot}/`)
    const targetInsideModule = targetRel?.startsWith(`${moduleRoot}/`) ?? false
    if (!sourceInsideModule && targetInsideModule) {
      return { file: rel, specifier, reason: '页面内模块只能通过目录根 index 进入' }
    }
  }

  // src 根的 main.tsx 只能经 app 公开入口启动。
  if (!source.layer) {
    if (rel === 'main.tsx' && specifier === '@/app') return null
    return { file: rel, specifier, reason: 'src 根入口只能 import @/app' }
  }

  // entities 被定义为一个数据模块：上层只走唯一门面。
  if (target.layer === 'entities' && source.layer !== 'entities' && specifier !== '@/entities') {
    return { file: rel, specifier, reason: '上层只能通过 @/entities 使用数据模块' }
  }

  if (source.layer === 'shared' && target.layer !== 'shared') {
    return { file: rel, specifier, reason: 'shared 不得依赖业务层' }
  }

  if (target.layer === source.layer) {
    if (ISOLATED_SLICE_LAYERS.has(source.layer) && target.slice !== source.slice) {
      return { file: rel, specifier, reason: '同层 Slice 不得互相 import' }
    }
    return null
  }

  if (!ALLOWED[source.layer]?.includes(target.layer)) {
    return { file: rel, specifier, reason: `${source.layer} 不得依赖 ${target.layer}` }
  }

  // 跨层只能引到目标 Slice 根，再深就是绕过 index.ts。
  if (target.rest.length > 0) {
    return { file: rel, specifier, reason: '跨 Slice 只能走公开接口 index.ts' }
  }

  return null
}

function collectViolations(): Violation[] {
  const found: Violation[] = []
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8')
    for (const specifier of moduleSpecifiers(file, source)) {
      const violation = violationFor(file, specifier)
      if (violation) found.push(violation)
    }
  }
  return found
}

function resolveInternalFile(file: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(file), specifier)
  else return null

  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

function collectCycles(): string[][] {
  const files = walk(SRC)
  const graph = new Map<string, string[]>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const targets = moduleSpecifiers(file, source)
      .map((specifier) => resolveInternalFile(file, specifier))
      .filter((target): target is string => target !== null)
    graph.set(file, targets)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []

  function visit(file: string): void {
    if (visiting.has(file)) {
      const start = stack.indexOf(file)
      cycles.push([...stack.slice(start), file].map((item) => relativeSrc(item)))
      return
    }
    if (visited.has(file)) return

    visiting.add(file)
    stack.push(file)
    for (const target of graph.get(file) ?? []) visit(target)
    stack.pop()
    visiting.delete(file)
    visited.add(file)
  }

  for (const file of files) visit(file)
  return cycles
}

type DeclaredSliceLayer = keyof typeof DECLARED_SLICES

function moduleOwnershipViolation(layer: DeclaredSliceLayer, actual: string[]): string | null {
  const expected = new Set<string>(DECLARED_SLICES[layer])
  const actualSet = new Set(actual)
  const unexpected = [...actualSet].filter((slice) => !expected.has(slice)).sort()
  const missing = [...expected].filter((slice) => !actualSet.has(slice)).sort()
  const reasons: string[] = []

  if (unexpected.length > 0) reasons.push(`有未登记目录：${unexpected.join('、')}`)
  if (missing.length > 0) reasons.push(`缺少已登记目录：${missing.join('、')}`)
  return reasons.length > 0 ? `${layer} ${reasons.join('；')}` : null
}

describe('依赖边界', () => {
  it('检查器能指出未登记的一级模块', () => {
    expect(
      moduleOwnershipViolation('entities', [...DECLARED_SLICES.entities, 'generation']),
    ).toBe('entities 有未登记目录：generation')
  })

  it('一级模块与全局审计清单完全一致，并各自提供公开入口', () => {
    const violations: string[] = []
    const actualLayers = readdirSync(SRC, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(actualLayers).toEqual(Object.keys(ALLOWED).sort())

    for (const layer of Object.keys(DECLARED_SLICES) as DeclaredSliceLayer[]) {
      const actual = readdirSync(join(SRC, layer), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      const ownership = moduleOwnershipViolation(layer, actual)
      if (ownership) violations.push(ownership)

      for (const slice of DECLARED_SLICES[layer]) {
        const root = join(SRC, layer, slice)
        if (!existsSync(join(root, 'index.ts')) && !existsSync(join(root, 'index.tsx'))) {
          violations.push(`${layer}/${slice} 缺少公开入口 index.ts(x)`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('检查器能识别生产代码直接选择能力 Mock Adapter', () => {
    const page = join(SRC, 'pages/quick-start/index.tsx')

    expect(
      capabilityMockViolation(page, '@/capabilities/image-generation/adapters/mock')?.reason,
    ).toBe('生产代码不得直接选择能力 Mock Adapter')
  })

  it('检查器能识别双引号、export-from 和动态 import', () => {
    const source = `
      import type { Project } from "@/entities"
      export { Review } from '@/features/review'
      const load = () => import("@/pages/workflow-editor")
    `
    expect(moduleSpecifiers('fixture.ts', source)).toEqual([
      '@/entities',
      '@/features/review',
      '@/pages/workflow-editor',
    ])
  })

  it.each([
    ['pages/workflow-editor/index.tsx', './editor', './editor/internal/canvas'],
    [
      'pages/playtest/index.tsx',
      './inspection-preview',
      './inspection-preview/internal/player',
    ],
  ])('%s 不能绕过页面内模块的目录根 index', (pagePath, root, deep) => {
    const page = join(SRC, pagePath)
    expect(violationFor(page, root)).toBeNull()
    expect(violationFor(page, deep)?.reason).toBe(
      '页面内模块只能通过目录根 index 进入',
    )
  })

  it('没有任何一条 import 违反分层、Slice 或模块入口规则', () => {
    const violations = collectViolations()
    expect(
      violations.map((violation) =>
        `${violation.file}: ${violation.specifier} —— ${violation.reason}`,
      ),
    ).toEqual([])
  })

  it('两个页面内模块不依赖 Router，脱离路由也能渲染与测试', () => {
    const offenders: string[] = []
    for (const moduleRoot of PAGE_MODULE_ROOTS) {
      const dir = join(SRC, moduleRoot)
      if (!existsSync(dir)) continue
      for (const file of walk(dir)) {
        if (/\.test\.tsx?$/.test(file)) continue
        if (/from\s+'react-router'|import\s+'react-router'/.test(readFileSync(file, 'utf8'))) {
          offenders.push(relative(SRC, file))
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('源码依赖图没有循环', () => {
    expect(collectCycles()).toEqual([])
  })

  it('业务层不得直接发网络请求或依赖测试辅助', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replaceAll('\\', '/')
      const source = readFileSync(file, 'utf8')
      const isTransport =
        rel.startsWith('shared/api/client/real/') ||
        rel === 'shared/api/upload.ts'
      if (!isTransport && /\bfetch\s*\(/.test(source)) {
        offenders.push(`${rel}: direct fetch`)
      }
      for (const specifier of moduleSpecifiers(file, source)) {
        if (specifier === '@/shared/testing' || specifier.startsWith('@/shared/testing/')) {
          offenders.push(`${rel}: ${specifier}`)
        }
        if (specifier === '@/tests' || specifier.startsWith('@/tests/')) {
          offenders.push(`${rel}: ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('WorkflowRun 是前端编排模型，不通过 HTTP transport', () => {
    const workflowRoot = join(SRC, 'entities/workflow-run')
    const orchestrationRoot = join(workflowRoot, 'orchestration')
    const offenders: string[] = []

    for (const file of walk(workflowRoot)) {
      if (/\.test\.tsx?$/.test(file)) continue
      const source = readFileSync(file, 'utf8')
      const rel = relativeSrc(file)
      if (moduleSpecifiers(file, source).includes('@/shared/api')) {
        offenders.push(`${rel}: imports @/shared/api`)
      }
      if (/['"`]\/workflow-runs?(?:\/|['"`])/.test(source)) {
        offenders.push(`${rel}: runtime workflow HTTP path`)
      }
      if (file.startsWith(orchestrationRoot)) {
        for (const specifier of moduleSpecifiers(file, source)) {
          const target = targetRelativePath(file, specifier)
          if (target?.startsWith('entities/workflow-run/local/')) {
            offenders.push(`${rel}: binds local repository directly`)
          }
        }
      }
    }

    if (!existsSync(join(workflowRoot, 'repository.ts'))) {
      offenders.push('entities/workflow-run/repository.ts composition entry is missing')
    }

    expect(offenders).toEqual([])
  })
})
