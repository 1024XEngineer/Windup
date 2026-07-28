/**
 * 人工审核、查看自动质检结果与退回修复。
 * 逐帧审核的 Canvas 与 Worker 归本 feature。
 * 不提供「通过此帧」：用户只在有问题时点退回。
 */
export interface ReviewProps {
  /** 要审核的后端 Character ID。 */
  characterId: string
  /** 受控选择中的 Action ID；省略表示尚未选中动作。 */
  actionId?: string
  /** 受控选择中的零基帧索引；省略表示尚未选中具体帧。 */
  frameIndex?: number
  /** 用户切换帧时通知宿主；Review 不保存第二份选择状态。 */
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
