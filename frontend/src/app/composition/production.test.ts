import { describe, expect, it } from 'vitest'

import { createProductionAppServices } from './production'

describe('生产应用组合', () => {
  it('Project 永远使用真实 Adapter', () => {
    const services = createProductionAppServices()

    expect(services.projects.adapterKind).toBe('real')
  })
})
