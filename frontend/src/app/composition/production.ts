import { createHttpProjectRepository } from '@/entities'
import type { AppServices } from './types'

/** 生产组合只接真实 Adapter；测试会锁定这条护栏。 */
export function createProductionAppServices(): AppServices {
  const projects = createHttpProjectRepository({ currentUserId: 1 })
  if (projects.adapterKind !== 'real') {
    throw new Error('生产环境禁止使用 Project Mock Repository')
  }
  return { projects }
}
