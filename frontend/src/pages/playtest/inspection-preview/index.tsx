import type { PlaytestStatus } from '@/entities'

export interface InspectionPreviewProps {
  /** 要在核验台加载的后端 Character ID。 */
  characterId: string
  /** 该核验记录所属的前端 WorkflowRun ID。 */
  runId: string
  /** 被核验的前端版本 ID；核验结果写回这个版本。 */
  revisionId: string
  /** 当前已保存的核验结论。 */
  status: PlaytestStatus
  /** 保存明确的通过或发现问题结论；未核验状态不能由用户提交。 */
  onRecordStatus: (status: Exclude<PlaytestStatus, 'not_tested'>) => Promise<void>
  /** 返回审核页面；具体路由和定位由外层 Page 决定。 */
  onOpenReview: () => void
}

/** 独立核验台外壳；真实播放器未接入时不伪造播放或通过结果。 */
export function InspectionPreview({
  characterId,
  runId,
  revisionId,
  status,
  onRecordStatus,
  onOpenReview,
}: InspectionPreviewProps) {
  return (
    <div className="space-y-5">
      <section className="border border-slate-200 p-5">
        <p className="text-sm text-slate-500">角色 {characterId}</p>
        <p className="mt-1 text-sm text-slate-500">
          来源 {runId} / {revisionId}
        </p>
        <div className="mt-5 min-h-56 border border-dashed border-slate-300 p-5 text-sm text-slate-500">
          播放器、按键绑定和动作状态机等待真实角色资产与渲染实现接入。
        </div>
      </section>

      <section className="border-t border-slate-200 pt-4">
        <p className="text-sm">当前核验结论：{status}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onRecordStatus('passed')}
            className="border border-slate-300 px-3 py-2 text-sm hover:border-slate-500"
          >
            记录为通过
          </button>
          <button
            type="button"
            onClick={() => void onRecordStatus('issues_found')}
            className="border border-slate-300 px-3 py-2 text-sm hover:border-slate-500"
          >
            记录发现问题
          </button>
          <button
            type="button"
            onClick={onOpenReview}
            className="border border-slate-300 px-3 py-2 text-sm hover:border-slate-500"
          >
            返回审核
          </button>
        </div>
        {status === 'issues_found' ? (
          <p className="mt-3 text-sm text-amber-700">
            建议从对应节点重新生成；该结论不会阻断当前版本导出。
          </p>
        ) : null}
      </section>
    </div>
  )
}
