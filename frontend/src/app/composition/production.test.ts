import { describe, expect, it } from 'vitest'

import { createProductionAppServices } from './production'

describe('生产应用组合', () => {
  it('正式接口未接入时明确拒绝 Project 请求', async () => {
    const services = createProductionAppServices()

    expect(services.projects.adapterKind).toBe('unavailable')
    await expect(services.projects.list()).rejects.toThrow('正式 Project API 尚未接入')
  })
})
