import { useState } from 'react'

import {
  WORKFLOW_NODE_ORDER,
  canImportToPlaytest,
  canRestartFromNode,
  getNodeByType,
} from '@/entities'
import type { WorkflowNodeType, WorkflowRevision, WorkflowRun } from '@/entities'
import { CharacterSetup } from '@/features/character-setup'
import { Export } from '@/features/export'
import { Generation } from '@/features/generation'
import { Review } from '@/features/review'

const NODE_LABELS: Record<WorkflowNodeType, string> = {
  asset: '资产设置',
  generation: 'AI 生成',
  candidate: '系统质检',
  review: '人工审核',
  export: '导出',
}

export interface WorkflowEditorProps {
  run: WorkflowRun
  revision: WorkflowRevision
  activeType: WorkflowNodeType
  readOnly: boolean
  onSelectNode: (type: WorkflowNodeType) => void
  onOpenRevision: (revisionId: string) => void
  onRestartNode: (nodeId: string) => Promise<void>
  onOpenPreview: (characterId: string) => void
}

/** 不读取 Router 的页面内编辑器；URL 和跨页导航全部由外层 Page 适配。 */
export function WorkflowEditor({
  run,
  revision,
  activeType,
  readOnly,
  onSelectNode,
  onOpenRevision,
  onRestartNode,
  onOpenPreview,
}: WorkflowEditorProps) {
  const [restarting, setRestarting] = useState(false)
  const activeNode = getNodeByType(revision, activeType)
  const canRestart = activeNode ? canRestartFromNode(run, revision.id, activeNode.id) : false

  async function restart() {
    if (!activeNode || restarting) return
    setRestarting(true)
    try {
      await onRestartNode(activeNode.id)
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div className="space-y-6">
      <section aria-label="工作流节点" className="border-y border-slate-200 py-4">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {WORKFLOW_NODE_ORDER.map((type, index) => {
            const node = getNodeByType(revision, type)
            const selected = type === activeType
            return (
              <li key={type} className="min-w-0">
                <button
                  type="button"
                  disabled={!node}
                  onClick={() => onSelectNode(type)}
                  className={`min-h-16 w-full border px-3 py-2 text-left text-sm ${
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                  } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300`}
                >
                  <span className="block text-xs opacity-70">{index + 1}</span>
                  <span className="block truncate font-medium">{NODE_LABELS[type]}</span>
                  <span className="block text-xs opacity-70">{node?.status ?? 'locked'}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-slate-500">
          {readOnly ? '历史只读' : '当前版本'} · {revision.id} · 生成 {revision.generationStatus}
        </p>
        {canRestart ? (
          <button
            type="button"
            disabled={restarting}
            onClick={() => void restart()}
            className="border border-slate-300 px-3 py-2 hover:border-slate-500 disabled:opacity-50"
          >
            {restarting ? '正在创建新版本…' : '从此节点重新开始'}
          </button>
        ) : null}
      </div>

      {activeNode ? (
        <StageContent
          run={run}
          revision={revision}
          type={activeType}
          readOnly={readOnly}
          onOpenPreview={onOpenPreview}
        />
      ) : (
        <p className="text-sm text-slate-500">该节点不在当前执行线上。</p>
      )}

      <section aria-label="版本历史" className="border-t border-slate-200 pt-5">
        <h2 className="text-sm font-semibold">版本历史</h2>
        <ul className="mt-3 space-y-2">
          {[...run.revisions].reverse().map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenRevision(item.id)}
                className="flex w-full items-center justify-between border border-slate-200 px-3 py-2 text-left text-sm hover:border-slate-400"
              >
                <span>{item.id}</span>
                <span className="text-slate-500">
                  {item.generationStatus} · {item.exportStatus} · {item.playtestStatus}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function StageContent({
  run,
  revision,
  type,
  readOnly,
  onOpenPreview,
}: {
  run: WorkflowRun
  revision: WorkflowRevision
  type: WorkflowNodeType
  readOnly: boolean
  onOpenPreview: (characterId: string) => void
}) {
  if (type === 'asset') {
    return readOnly ? (
      <ReadOnlyNotice text="查看该版本使用的资产输入。" />
    ) : (
      <CharacterSetup projectId={run.projectId} characterId={run.characterId ?? undefined} />
    )
  }
  if (type === 'generation') return <Generation runId={run.id} />
  if (type === 'candidate') {
    return (
      <ReadOnlyNotice
        text={
          revision.generationStatus === 'failed'
            ? '系统质检连续失败两次，需要从生成节点重新开始。'
            : '候选必须通过真实系统质检后才能交付；当前不提供模拟通过。'
        }
      />
    )
  }
  if (type === 'review') {
    return run.characterId ? (
      <Review characterId={run.characterId} />
    ) : (
      <ReadOnlyNotice text="生成结果尚未关联角色，无法进入人工审核。" />
    )
  }

  return (
    <div className="space-y-4">
      {run.characterId ? (
        <Export characterId={run.characterId} />
      ) : (
        <ReadOnlyNotice text="暂无可导出的角色。" />
      )}
      {run.characterId && canImportToPlaytest(run, revision.id) ? (
        <button
          type="button"
          onClick={() => onOpenPreview(run.characterId!)}
          className="border border-slate-300 px-4 py-2 text-sm hover:border-slate-500"
        >
          导入核验台
        </button>
      ) : null}
      {revision.playtestStatus === 'issues_found' ? (
        <p className="text-sm text-amber-700">核验台发现问题，建议重新生成；当前结果仍允许导出。</p>
      ) : null}
    </div>
  )
}

function ReadOnlyNotice({ text }: { text: string }) {
  return <p className="border border-dashed border-slate-300 p-5 text-sm text-slate-500">{text}</p>
}
