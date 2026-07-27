/**
 * 发起生成、重试、确认候选。
 * 宿主：quick-start、workflow-editor。生成是异步任务，进度由 entities 的 SSE 给。
 */
export interface GenerationProps {
  runId: string
  /** 生成哪个动作；不传表示生成母版。 */
  actionId?: number
  onGenerated?: (actionId: number) => void
}

export function Generation({ runId, actionId }: GenerationProps) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-400">
      生成待实现（工作流 {runId}
      {actionId ? ` · 动作 ${actionId}` : ' · 母版'}）。
    </section>
  )
}
