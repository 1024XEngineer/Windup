import { createMemoryProjectRepository } from './mocks/project'
import type { AppServices } from './types'

export interface CreateDevelopmentAppServicesOptions {
  projectLatencyMs?: number
}

/** 开发组合只在 loadAppServices 的动态开发分支中加载。 */
export function createDevelopmentAppServices({
  projectLatencyMs = 0,
}: CreateDevelopmentAppServicesOptions = {}): AppServices {
  return {
    projects: createMemoryProjectRepository({ latencyMs: projectLatencyMs }),
  }
}
