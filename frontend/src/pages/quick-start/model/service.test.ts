import { describe, expectTypeOf, it } from 'vitest'

import type { QuickStartService, QuickStartSession } from './service'

describe('QuickStartService 页面服务边界', () => {
  it('中断的是自动创作会话，不直接暴露生成尝试取消或流程重启', () => {
    expectTypeOf<QuickStartService>().toHaveProperty('interrupt')
    expectTypeOf<QuickStartService>().toHaveProperty('getSession')
    expectTypeOf<QuickStartService>().not.toHaveProperty('cancelAttempt')
    expectTypeOf<QuickStartService>().not.toHaveProperty('restart')
  })

  it('后端取消能力增强时不改变会话级中断签名', () => {
    expectTypeOf<QuickStartService['interrupt']>().toEqualTypeOf<
      (runId: QuickStartSession['runId']) => Promise<void>
    >()
  })
})
