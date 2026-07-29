import type { GenerationInput, GenerationResultFor } from '@/capabilities/image-generation'

/** 一次制作调用必须指向精确的前端工作流节点和生成尝试。 */
export interface GenerationAttemptTarget {
  runId: string
  revisionId: string
  nodeId: string
  /** 由未来制作控制器在调用前生成，用于区分同一节点的多次尝试。 */
  attemptId: string
}

/**
 * Quick Start 与手动 Workflow 共同依赖的制作端口。
 * Preview 在 app 组合层提供同契约 Mock；生产环境未配置真实 Adapter 时明确失败，不回退 Mock。
 */
export interface ProductionEnginePort {
  generate<T extends GenerationInput>(input: {
    target: GenerationAttemptTarget
    request: T
  }): Promise<GenerationResultFor<T>>
  /**
   * 使指定 attempt 在前端立即失效，其迟到结果不得再写回。
   * 未来实现会同时通过 ImageGeneration Adapter 与 TaskRepository 尽力请求后端取消；
   * Promise 完成只表示前端取消流程已执行，不保证已运行的远端计算终止。
   * 本方法不停止 Quick Start 会话，也不创建新 Revision。
   */
  cancelAttempt(target: GenerationAttemptTarget): Promise<void>
}
