import { describe, expectTypeOf, it } from 'vitest'

import type { MediaReference } from '@/entities'
import type { ImageUploadPort } from './port'

describe('ImageUploadPort 契约', () => {
  it('返回不透明媒体引用，不暴露 Adapter 类型', () => {
    expectTypeOf<ImageUploadPort>().not.toHaveProperty('adapterKind')
    expectTypeOf<ReturnType<ImageUploadPort['upload']>>().toEqualTypeOf<Promise<MediaReference>>()
  })
})
