import { describe, expectTypeOf, it } from 'vitest'

import type { ActionType, MediaReference } from '@/entities'
import type {
  CharacterTemplateGenerationInput,
  CharacterTemplateGenerationResult,
  CompleteAnimationGenerationInput,
  CompleteAnimationGenerationResult,
  FirstFrameGenerationInput,
  FirstFrameGenerationResult,
  GenerationInput,
  GenerationResult,
} from './types'

describe('Generation 类型契约', () => {
  it('不同生成类型拥有各自的输入形状', () => {
    expectTypeOf<CharacterTemplateGenerationInput>()
      .toHaveProperty('type')
      .toEqualTypeOf<'character_template'>()
    expectTypeOf<CharacterTemplateGenerationInput>()
      .toHaveProperty('referenceMedia')
      .toEqualTypeOf<readonly MediaReference[]>()

    expectTypeOf<FirstFrameGenerationInput>().toHaveProperty('type').toEqualTypeOf<'first_frame'>()
    expectTypeOf<FirstFrameGenerationInput>().toHaveProperty('outfitId').toBeString()
    expectTypeOf<FirstFrameGenerationInput>()
      .toHaveProperty('actionType')
      .toEqualTypeOf<ActionType>()
    expectTypeOf<CompleteAnimationGenerationInput>()
      .toHaveProperty('type')
      .toEqualTypeOf<'complete_animation'>()
    expectTypeOf<CompleteAnimationGenerationInput>().toHaveProperty('firstFrameUrl').toBeString()
    expectTypeOf<GenerationInput>().not.toHaveProperty('referenceImageUrls')
  })

  it('不同生成类型拥有各自的结果形状', () => {
    expectTypeOf<CharacterTemplateGenerationResult>()
      .toHaveProperty('type')
      .toEqualTypeOf<'character_template'>()
    expectTypeOf<CharacterTemplateGenerationResult>().toHaveProperty('images')
    expectTypeOf<CharacterTemplateGenerationResult>().not.toHaveProperty('frames')

    expectTypeOf<FirstFrameGenerationResult>().toHaveProperty('type').toEqualTypeOf<'first_frame'>()
    expectTypeOf<FirstFrameGenerationResult>().toHaveProperty('image')
    expectTypeOf<CompleteAnimationGenerationResult>()
      .toHaveProperty('type')
      .toEqualTypeOf<'complete_animation'>()
    expectTypeOf<CompleteAnimationGenerationResult>().toHaveProperty('frames')
    expectTypeOf<CompleteAnimationGenerationResult>().not.toHaveProperty('images')
    expectTypeOf<GenerationResult>().toHaveProperty('type')
  })
})
