import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadAppServices } from './index'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('应用组合选择', () => {
  it('Preview 构建显式使用 Memory Repository', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_APP_ENV', 'preview')

    const services = await loadAppServices()

    expect(services.projects.adapterKind).toBe('mock')
  })

  it('开发环境默认使用 Memory Repository', async () => {
    vi.stubEnv('VITE_PROJECT_ADAPTER', '')

    const services = await loadAppServices()

    expect(services.projects.adapterKind).toBe('mock')
  })

  it('开发环境只有显式配置时才使用 PR #57 候选 Repository', async () => {
    vi.stubEnv('VITE_PROJECT_ADAPTER', 'pr57-candidate')

    const services = await loadAppServices()

    expect(services.projects.adapterKind).toBe('candidate')
  })

  it('生产环境忽略候选配置并保持不可用', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_APP_ENV', '')
    vi.stubEnv('VITE_PROJECT_ADAPTER', 'pr57-candidate')

    const services = await loadAppServices()

    expect(services.projects.adapterKind).toBe('unavailable')
  })
})
