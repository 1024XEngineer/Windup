import { createProductionAppServices } from './production'
import type { AppServices } from './types'

/** Preview/开发使用与真实端口同形的 Mock 组合；生产不引入 Mock 退化。 */
export async function loadAppServices(): Promise<AppServices> {
  if (import.meta.env.DEV || import.meta.env.VITE_APP_ENV === 'preview') {
    const { createDevelopmentAppServices } = await import('./development')
    return createDevelopmentAppServices()
  }
  return createProductionAppServices()
}

export type { AppServices } from './types'
