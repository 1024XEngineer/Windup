import type { ProjectRepository } from '@/entities'
import type { AppServices } from './types'

const PROJECT_API_UNAVAILABLE = '正式 Project API 尚未接入'

function rejectUnavailable(): Promise<never> {
  return Promise.reject(new Error(PROJECT_API_UNAVAILABLE))
}

/** 生产组合不接 Mock，也不把未确认的 PR #57 路由当成正式接口。 */
export function createProductionAppServices(): AppServices {
  const projects: ProjectRepository = {
    adapterKind: 'unavailable',
    list: rejectUnavailable,
    get: rejectUnavailable,
    create: rejectUnavailable,
    remove: rejectUnavailable,
  }

  return { projects }
}
