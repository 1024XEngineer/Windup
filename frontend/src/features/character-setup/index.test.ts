import { expectTypeOf, it } from 'vitest'

import type { CharacterSetupNodeInput } from '@/entities'
import type { CharacterSetupProps } from '.'

it('submits WorkflowRun character setup input', () => {
  expectTypeOf<CharacterSetupProps['onSubmit']>()
    .parameter(0)
    .toEqualTypeOf<CharacterSetupNodeInput>()
})
