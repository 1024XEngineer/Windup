import type { CreateProjectInput } from '@/entities'

export interface QuickStartInput {
  /** 用户用自然语言描述的最终产物。 */
  prompt: string
}

export type QuickStartProjectPlanner = (input: QuickStartInput) => Promise<CreateProjectInput>

const PROJECT_NAME_LIMIT = 20
const DEFAULT_NAME_SUFFIX_LENGTH = 6
let fallbackSuffixSequence = 0

function defaultNameSuffix(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const value = new Uint32Array(1)
    cryptoApi.getRandomValues(value)
    return value[0].toString(36).padStart(DEFAULT_NAME_SUFFIX_LENGTH, '0').slice(-6)
  }

  fallbackSuffixSequence += 1
  return `${Date.now().toString(36)}${fallbackSuffixSequence.toString(36)}`.slice(
    -DEFAULT_NAME_SUFFIX_LENGTH,
  )
}

/**
 * 当前没有 Agent 参数规划接口，先把临时 MS2 默认值隔离在 Planner 中。
 * 将来只替换 Planner，不改 Quick Start 页面或启动用例。
 */
export function createMvpQuickStartProjectPlanner(
  createNameSuffix: () => string = defaultNameSuffix,
): QuickStartProjectPlanner {
  return async (input) => {
    const prompt = input.prompt.trim().replace(/\s+/g, ' ')
    if (!prompt) throw new Error('请先描述要制作的角色。')

    const suffix = createNameSuffix().trim().slice(-DEFAULT_NAME_SUFFIX_LENGTH)
    const reservedLength = suffix ? suffix.length + 1 : 0
    const namePrefix = Array.from(prompt)
      .slice(0, PROJECT_NAME_LIMIT - reservedLength)
      .join('')

    return {
      name: suffix ? `${namePrefix}-${suffix}` : namePrefix,
      perspective: 'side',
      directionalMovement: 'four-way',
      spriteSize: { width: 64, height: 64 },
      gameStyle: null,
      sampleImageUrl: null,
    }
  }
}

export const planMvpQuickStartProject = createMvpQuickStartProjectPlanner()
