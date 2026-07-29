import { describe, expectTypeOf, it } from 'vitest'

import type {
  CompleteAnimationGenerationInput,
  CompleteAnimationGenerationResult,
} from '@/capabilities/image-generation'
import type { GenerationAttemptTarget, ProductionEnginePort } from './contract'

describe('ProductionEnginePort 控制边界', () => {
  it('只取消精确生成尝试，不承担 Quick Start 中断或流程重启', () => {
    expectTypeOf<ProductionEnginePort>().toHaveProperty('cancelAttempt')
    expectTypeOf<ProductionEnginePort>().not.toHaveProperty('interruptGeneration')
    expectTypeOf<ProductionEnginePort>().not.toHaveProperty('interrupt')
    expectTypeOf<ProductionEnginePort>().not.toHaveProperty('restart')
  })

  it('上层取消始终使用精确 attempt，不暴露底层 Task 取消能力', () => {
    expectTypeOf<ProductionEnginePort['cancelAttempt']>().toEqualTypeOf<
      (target: GenerationAttemptTarget) => Promise<void>
    >()
    expectTypeOf<GenerationAttemptTarget>().toHaveProperty('attemptId')
    expectTypeOf<GenerationAttemptTarget>().not.toHaveProperty('taskId')
  })

  it('屏蔽底层 Task 生命周期，对上返回按类型区分的最终生成结果', () => {
    type GenerateCharacterAction = (input: {
      target: GenerationAttemptTarget
      request: CompleteAnimationGenerationInput
    }) => Promise<CompleteAnimationGenerationResult>

    expectTypeOf<ProductionEnginePort['generate']>().toMatchTypeOf<GenerateCharacterAction>()
  })
})
