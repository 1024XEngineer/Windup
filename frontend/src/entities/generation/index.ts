/**
 * Generation 模块的唯一公共出口。
 *
 * 这里只转发业务记录、状态、创建输入及 APIs 类型，不暴露模型供应商、图片生成
 * SDK 或后端内部任务实现。
 */
export type { GenerationAPIs } from './apis'
export type { CreateGenerationInput, Generation, GenerationStatus, GenerationType } from './types'
