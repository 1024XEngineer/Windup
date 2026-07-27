/**
 * 人工审核、查看自动质检结果与退回修复。
 * 逐帧审核的 Canvas 与 Worker 归本 feature。
 * 不提供「通过此帧」：用户只在有问题时点退回。
 */
export interface ReviewProps {
  /** 进来只需要一个角色。 */
  characterId: string
  /** 受控选择：当前动作与帧由宿主持有，Review 不再保存第二份状态。 */
  actionId?: string
  frameIndex?: number
  onSelectFrame?: (actionId: string, frameIndex: number) => void
  /** 退回某帧。只报告是哪一帧，跳去哪由宿主决定。 */
  onRejectFrame?: (actionId: string, frameIndex: number) => void
}

export function Review({ characterId, actionId, frameIndex }: ReviewProps) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-400">
      逐帧审核待实现（角色 {characterId}
      {actionId ? ` · 动作 ${actionId}` : ''}
      {frameIndex !== undefined ? ` · 第 ${frameIndex + 1} 帧` : ''}）。
    </section>
  )
}
