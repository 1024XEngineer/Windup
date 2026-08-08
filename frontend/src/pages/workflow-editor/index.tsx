import { useParams } from 'react-router'

import type { ActionGenerationMethod } from '@/entities'
import { PageContainer } from '@/shared/ui'

const WORKFLOW_CARDS = [
  { index: '01', title: '角色设定', detail: '输入身份、外观与参考图' },
  { index: '02', title: '角色母版', detail: '生成并确认角色母版' },
  { index: '03', title: '动作首帧', detail: '生成并确认动作起始帧' },
  { index: '04', title: '资产生成方式', detail: '选择视频裁剪或 3D 转 2D' },
  { index: '05', title: '完整动画', detail: '按所选路线生成 32 帧动画' },
  { index: '06', title: '审核', detail: '核验结果并进入 Playtest' },
] as const

export interface WorkflowEditorPageProps {
  selectedGenerationMethod?: ActionGenerationMethod | null
  onSelectGenerationMethod?: (method: ActionGenerationMethod) => void
}

/** 工作流画布骨架；真实状态只来自 WorkflowRun，不在页面内伪造节点推进。 */
export function WorkflowEditorPage({
  selectedGenerationMethod = null,
  onSelectGenerationMethod,
}: WorkflowEditorPageProps = {}) {
  const { runId } = useParams<{ runId: string }>()
  return (
    <PageContainer>
      <section aria-labelledby="workflow-editor-title">
        <header className="border-b border-slate-200 pb-5">
          <p className="text-xs font-semibold text-emerald-700">WORKFLOW EDITOR</p>
          <h1 id="workflow-editor-title" className="mt-2 text-2xl font-semibold text-slate-950">
            {runId ? `工作流 ${runId.slice(0, 8)}` : '工作流画布'}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            首帧确认后先选择资产生产路线，再进入完整动画生成。
          </p>
        </header>

        <ol className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {WORKFLOW_CARDS.map((card) => (
            <li key={card.index} className="border border-slate-200 bg-white p-4">
              <span className="text-xs font-semibold text-slate-400">{card.index}</span>
              <h2 className="mt-2 text-base font-semibold text-slate-900">{card.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{card.detail}</p>
              {card.index === '04' ? (
                <GenerationMethodChoice
                  selected={selectedGenerationMethod}
                  onSelect={onSelectGenerationMethod}
                />
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </PageContainer>
  )
}

function GenerationMethodChoice({
  selected,
  onSelect,
}: {
  selected: ActionGenerationMethod | null
  onSelect?: (method: ActionGenerationMethod) => void
}) {
  return (
    <div className="mt-4 grid gap-2" aria-label="资产生成方式">
      <button
        type="button"
        aria-pressed={selected === 'video-cropping'}
        disabled={!onSelect}
        onClick={() => onSelect?.('video-cropping')}
        className="border border-slate-300 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:text-slate-500"
      >
        <strong className="block">视频裁剪</strong>
        <span className="text-xs text-slate-500">当前已提供接口</span>
      </button>
      <button
        type="button"
        aria-pressed={selected === '3d-to-2d'}
        disabled={!onSelect}
        onClick={() => onSelect?.('3d-to-2d')}
        className="border border-slate-300 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:text-slate-500"
      >
        <strong className="block">3D 转 2D</strong>
        <span className="text-xs text-slate-500">等待后端接口</span>
      </button>
    </div>
  )
}
