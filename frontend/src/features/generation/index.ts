/** 触发并展示一次生成；不感知后端调用的是哪个模型。 */
export interface GenerationProps {
  runId: string
  /**
   * 目标动作，生成母版等非动作任务可以省略。
   * 动作 ID 只在造型内唯一，所以造型由 runId 对应的 WorkflowRun.outfitId 决定，
   * 不能脱离 run 单独使用这个字段。
   */
  actionId?: string
}
