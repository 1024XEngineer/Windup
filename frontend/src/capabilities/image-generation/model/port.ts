import type { Task } from '@/entities'
import type { GenerationInput } from './types'

/** 单次生成调用的运行时选项；不属于生成业务输入。 */
export interface ImageGenerationCallOptions {
  /** 上层中断当前 attempt 时，Adapter 应尽快停止网络请求。 */
  signal?: AbortSignal
}

/**
 * 图片生成的业务能力端口。
 * Real Adapter 将来负责 HTTP DTO 映射，调用方只依赖这里的业务形状。
 */
export interface ImageGenerationPort {
  /**
   * 只提交后端异步任务；返回 Task.type 与输入判别字段保持同一字面量类型。
   * Task.result 仍为 unknown，结果解析和等待由 Application 用例在运行时编排。
   */
  submit<T extends GenerationInput>(
    input: T,
    options?: ImageGenerationCallOptions,
  ): Promise<Task<T['type']>>
}
