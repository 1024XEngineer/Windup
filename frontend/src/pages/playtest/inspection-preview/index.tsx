import type { Outfit, PlaytestInspectionStatus } from '@/entities'

export interface InspectionPreviewProps {
  /** 要核验的 Character ID。 */
  characterId: string
  /** 要播放和核验的具体造型；动作与帧都从这棵只读数据中取。 */
  outfit: Outfit
  /** 从某个动作进入时的初始定位。 */
  initialActionId?: string
  /** 最近一次已保存的独立核验结论；null 表示尚未记录。 */
  status: PlaytestInspectionStatus | null
  /** 核验记录正在持久化时禁用重复提交。 */
  saving?: boolean
  /** 最近一次保存失败信息；不清空已加载的播放数据。 */
  saveError?: string | null
  /** 只上报本组件知道的核验结论，持久化由外层 Repository 完成。 */
  onRecordStatus: (status: PlaytestInspectionStatus) => Promise<void>
  /** 仅 Workflow 来源入口提供返回审核能力。 */
  onOpenReview?: () => void
}

/** 独立核验台外壳；真实播放器未接入时不伪造播放或通过结果。 */
export function InspectionPreview({
  characterId,
  outfit,
  initialActionId,
  status,
  saving = false,
  saveError = null,
  onRecordStatus,
  onOpenReview,
}: InspectionPreviewProps) {
  return (
    <div className="space-y-5">
      <section className="border border-slate-200 p-5">
        <p className="text-sm text-slate-500">角色 {characterId}</p>
        <p className="mt-1 text-sm text-slate-500">造型 {outfit.name}</p>
        <div className="mt-5 min-h-56 border border-dashed border-slate-300 p-5 text-sm text-slate-500">
          {outfit.actions.length === 0
            ? '当前造型还没有可播放动作。'
            : `已读取 ${outfit.actions.length} 个动作${initialActionId ? `，初始定位 ${initialActionId}` : ''}。`}
        </div>
      </section>

      <section className="border-t border-slate-200 pt-4">
        <p className="text-sm">当前核验结论：{status ?? '尚未记录'}</p>
        <p className="mt-1 text-sm text-slate-500">
          结论单独保存，不修改角色、工作流版本或生成产物。
        </p>
        {saveError ? <p className="mt-2 text-sm text-red-600">保存失败：{saveError}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void onRecordStatus('passed')}
            className="border border-slate-300 px-3 py-2 text-sm hover:border-slate-500"
          >
            记录为通过
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onRecordStatus('issues_found')}
            className="border border-slate-300 px-3 py-2 text-sm hover:border-slate-500"
          >
            记录发现问题
          </button>
          {onOpenReview ? (
            <button
              type="button"
              onClick={onOpenReview}
              className="border border-slate-300 px-3 py-2 text-sm hover:border-slate-500"
            >
              返回审核
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}
