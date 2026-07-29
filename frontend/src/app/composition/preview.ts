import { createDevelopmentAppServices } from './development'
import type { AppServices } from './types'

/** Vercel Preview 显式使用演示数据；正式生产组合不会经过这个入口。 */
export function createPreviewAppServices(): AppServices {
  return createDevelopmentAppServices({ projectLatencyMs: 0 })
}
