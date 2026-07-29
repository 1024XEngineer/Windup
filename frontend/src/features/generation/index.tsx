/** Generation 只保留图片生成能力的页面接口，不感知后端 Provider。 */
export interface GenerationProps {
  /** 当前前端 WorkflowRun ID，仅用于页面编排和任务关联。 */
  runId: string
  /** 要生成的 Action ID；生成母版等非动作任务可以省略。 */
  actionId?: string
}

export function Generation({ runId, actionId }: GenerationProps) {
  return (
    <section className="space-y-3 border border-dashed border-slate-300 p-6 text-sm">
      <p className="font-medium">AI 生成</p>
      <p className="text-slate-500">
        工作流 {runId}
        {actionId ? ` · 动作 ${actionId}` : ''}
      </p>
      <p className="text-slate-500">图片生成接口待接入。</p>
      <p className="text-xs text-slate-400">
        后端使用哪个 Provider 不属于前端契约；当前不会模拟生成成功。
      </p>
    </section>
  )
}
