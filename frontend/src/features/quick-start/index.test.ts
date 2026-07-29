import { describe, expectTypeOf, it } from 'vitest'

import type { QuickStartPort, QuickStartSession } from './index'

describe('QuickStartPort 控制边界', () => {
  it('中断的是自动创作会话，不直接暴露生成尝试取消或流程重启', () => {
    expectTypeOf<QuickStartPort>().toHaveProperty('interrupt')
    expectTypeOf<QuickStartPort>().toHaveProperty('getSession')
    expectTypeOf<QuickStartPort>().not.toHaveProperty('cancelAttempt')
    expectTypeOf<QuickStartPort>().not.toHaveProperty('restart')
  })

  it('后端取消能力增强时不改变会话级中断签名', () => {
    expectTypeOf<QuickStartPort['interrupt']>().toEqualTypeOf<
      (runId: QuickStartSession['runId']) => Promise<void>
    >()
  })
})
