import { describe, expectTypeOf, it } from 'vitest'

import type { WorkflowRestartPort } from './index'

describe('WorkflowRestartPort 控制边界', () => {
  it('只负责从旧节点建立新执行线', () => {
    expectTypeOf<WorkflowRestartPort>().toHaveProperty('restart')
    expectTypeOf<WorkflowRestartPort>().not.toHaveProperty('interrupt')
    expectTypeOf<WorkflowRestartPort>().not.toHaveProperty('cancelAttempt')
  })
})
