import { createProductionAppServices } from './production'
import type { AppServices } from './types'

/**
 * 只在应用入口选择实现。生产构建固定使用 HTTP；开发可显式设
 * VITE_PROJECT_ADAPTER=http 联调，否则动态加载内存实现。
 */
export async function loadAppServices(): Promise<AppServices> {
  if (import.meta.env.PROD || import.meta.env.VITE_PROJECT_ADAPTER === 'http') {
    return createProductionAppServices()
  }

  const { createDevelopmentAppServices } = await import('./development')
  return createDevelopmentAppServices({ projectLatencyMs: 200 })
}

export type { AppServices } from './types'
