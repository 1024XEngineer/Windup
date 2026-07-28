import type { ProjectRepository } from '@/entities'

/** 由应用启动阶段一次性选择的外部实现。 */
export interface AppServices {
  projects: ProjectRepository
}
