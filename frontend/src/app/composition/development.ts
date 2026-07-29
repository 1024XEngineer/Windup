import { createMemoryProjectRepository } from './mocks/project'
import type { AppServices } from './types'

export interface CreateDevelopmentAppServicesOptions {
  projectLatencyMs?: number
}

/** 开发与 Preview 演示复用同一内存实现；具体环境只由 app 入口选择。 */
export function createDevelopmentAppServices({
  projectLatencyMs = 0,
}: CreateDevelopmentAppServicesOptions = {}): AppServices {
  return {
    projects: createMemoryProjectRepository({ latencyMs: projectLatencyMs }),
  }
}
