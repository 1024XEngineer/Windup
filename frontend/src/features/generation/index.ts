/** 触发并展示一次生成；不感知后端调用的是哪个模型。 */
export interface GenerationProps {
  runId: string
  /** 生成母版等非动作任务可以省略。 */
  actionId?: string
}
