import { describe, expectTypeOf, it } from 'vitest'

import type { WorkflowRunRepository } from './repository'
import type { WorkflowRun } from './types'

describe('WorkflowRunRepository 契约', () => {
  it('所有操作都使用可等待的网络形状', () => {
    expectTypeOf<ReturnType<WorkflowRunRepository['create']>>().toEqualTypeOf<
      Promise<WorkflowRun>
    >()
    expectTypeOf<ReturnType<WorkflowRunRepository['get']>>().toEqualTypeOf<
      Promise<WorkflowRun | null>
    >()
    expectTypeOf<ReturnType<WorkflowRunRepository['submit']>>().toEqualTypeOf<
      Promise<WorkflowRun>
    >()
  })
})
