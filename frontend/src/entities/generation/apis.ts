/**
 * Generation 业务记录对应的服务端接口集合。
 *
 * 前端只创建记录并读取最新快照；模型调用、队列处理和事件传输属于服务端或尚未
 * 冻结的合同，不在本文件提前实现。
 */
import type { CreateGenerationInput, Generation } from './types'

/** Generation 业务记录对应的服务端 API。 */
export interface GenerationAPIs {
  /** 按不同生成阶段创建一条业务记录。 */
  create(input: CreateGenerationInput): Promise<Generation>
  /** 读取 Generation 的当前状态与结果。 */
  get(generationId: Generation['id']): Promise<Generation>
}
