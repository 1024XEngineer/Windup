/**
 * 后端 API 适配器统一入口。
 *
 * 页面按需引入所需适配器，不通过全局依赖注入：
 *   import { createProjectApis } from '@/app/adapters'
 *   const projectApis = createProjectApis()
 */

export { createProjectApis } from './project'
export { createCharacterApis } from './character'
export { createTaskApis } from './task'
export { createGenerationApis } from './generation'
export { createMediaApis } from './media'
export type { MediaApis, MediaCategory } from './media'
export { ApiError } from './http-client'
