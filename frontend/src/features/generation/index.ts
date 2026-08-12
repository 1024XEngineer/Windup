/** 触发并展示一次生成；不感知后端调用的是哪个模型。 */
export interface GenerationProps {
  runId: string
  /**
   * 目标动作，生成母版等非动作任务可以省略。
   * 动作 ID 只在造型内唯一；调用方需用 runId 找到绑定 Character，再从
   * WorkflowRun 动作节点的 input.outfitId 确定造型，不能脱离两者单独使用此字段。
   */
  actionId?: string
}
