/** Generation 只展示当前工作流的生成入口；真实任务由后端契约接入。 */
export interface GenerationProps {
  /** 当前前端 WorkflowRun ID，仅用于页面编排和任务关联。 */
  runId: string
}

export function Generation({ runId }: GenerationProps) {
  return (
    <section className="space-y-3 border border-dashed border-slate-300 p-6 text-sm">
      <p className="font-medium">AI 生成</p>
      <p className="text-slate-500">工作流 {runId}</p>
      <p className="text-slate-500">生成服务尚未接入。</p>
      <p className="text-xs text-slate-400">真实任务和产物由后端接口接入；当前不会模拟生成成功。</p>
    </section>
  )
}
