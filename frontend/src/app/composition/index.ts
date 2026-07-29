import { createProductionAppServices } from './production'
import type { AppServices } from './types'

/**
 * 只在应用入口选择实现。Vercel Preview 显式使用演示组合；开发默认使用内存
 * Repository，PR #57 候选映射只能由开发环境显式启用。生产环境在正式
 * OpenAPI 到位前明确不可用。
 */
export async function loadAppServices(): Promise<AppServices> {
  if (import.meta.env.VITE_APP_ENV === 'preview') {
    const { createPreviewAppServices } = await import('./preview')
    return createPreviewAppServices()
  }

  if (import.meta.env.PROD) {
    return createProductionAppServices()
  }

  if (import.meta.env.VITE_PROJECT_ADAPTER === 'pr57-candidate') {
    const { createHttpProjectRepository } = await import('@/entities')
    return { projects: createHttpProjectRepository({ currentUserId: 1 }) }
  }

  const { createDevelopmentAppServices } = await import('./development')
  return createDevelopmentAppServices({ projectLatencyMs: 200 })
}

export type { AppServices } from './types'
