import { describe, expectTypeOf, it } from 'vitest'

import type { Task } from '@/entities'
import type { ImageGenerationCallOptions, ImageGenerationPort } from './port'
import type { GenerationInput } from './types'

describe('ImageGenerationPort 契约', () => {
  it('只提交异步任务，不伪装成立即返回生成结果', () => {
    expectTypeOf<ImageGenerationPort['submit']>().toEqualTypeOf<
      <T extends GenerationInput>(
        input: T,
        options?: ImageGenerationCallOptions,
      ) => Promise<Task<T['type']>>
    >()
    expectTypeOf<ImageGenerationPort>().not.toHaveProperty('generate')
    expectTypeOf<ImageGenerationPort>().not.toHaveProperty('adapterKind')
  })
})
