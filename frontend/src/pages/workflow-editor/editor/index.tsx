import { useEffect, useState } from 'react'

import {
  availableCommands,
  locateFrame,
  useWorkflowRun,
} from '@/entities'
import type { Action, Character, Frame, WorkflowRun, WorkflowStep } from '@/entities'
import { Export } from '@/features/export'
import { Generation } from '@/features/generation'
import { Review } from '@/features/review'

/** 编辑器可定位到节点，或进一步定位到某一帧。 */
export type WorkflowEditorFocus =
  | {
      kind: 'step'
      stepId: WorkflowStep['id']
    }
  | {
      kind: 'frame'
      stepId: WorkflowStep['id']
      actionId: Action['id']
      frameIndex: Frame['index']
    }

/**
 * Workflow Editor 模块的全部公开接口。
 *
 * 运行数据由模块自己经 entities 加载；模块不读 Router，只上报跨页意图。
 */
export interface WorkflowEditorProps {
  runId: WorkflowRun['id']
  focus?: WorkflowEditorFocus
  onOpenPreview: (characterId: Character['id']) => void
}

/**
 * 用户手动组织、查看并运行 Workflow 的编辑器。
 *
 * 本 Issue 只落模块边界；画布、拖拽与真实节点面板属后续实现。
 */
export function WorkflowEditor({ runId, focus, onOpenPreview }: WorkflowEditorProps) {
  const { data: run, loading, error } = useWorkflowRun(runId)
  const [activeFocus, setActiveFocus] = useState<WorkflowEditorFocus | undefined>(focus)

  // 依赖 focus 的内容而不是对象引用：readFocus 每次渲染都产生新对象，
  // 按引用比较会在 Page 任意一次重渲染时把用户在画布里点选的帧覆盖回 URL 里的值。
  const focusKey = serializeFocus(focus)
  useEffect(() => {
    setActiveFocus(focus)
    // focus 的内容已由 focusKey 表达
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  if (loading) return <p className="text-sm text-slate-400">加载中…</p>
  if (error) return <p className="text-sm text-red-500">加载失败：{error.message}</p>
  if (!run) return null
  const loadedRun = run
  const characterId = run.characterId

  const selectFrame = (actionId: number, frameIndex: number): void => {
    const target = locateFrame(loadedRun, actionId, frameIndex)
    if (!target) return
    setActiveFocus({
      kind: 'frame',
      stepId: target.stepId,
      actionId: target.actionId,
      frameIndex: target.frameIndex,
    })
  }

  // 退回与选中语义不同：退回除定位外还要标记该帧被拒，
  // 等 entities 提供写入接口后在此补上，先不与 selectFrame 合流。
  const rejectFrame = (actionId: number, frameIndex: number): void => {
    selectFrame(actionId, frameIndex)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        状态 {run.status} · 当前步骤 {run.currentStepId ?? '（无）'} · 可执行{' '}
        {availableCommands(run).join('、') || '（无）'}
      </p>
      {activeFocus ? (
        <p className="text-sm text-slate-500">{describeFocus(activeFocus)}</p>
      ) : null}
      <p className="text-sm text-slate-400">画布待实现，下面按节点切换显示各 Feature。</p>
      <Generation runId={run.id} />
      {characterId !== null ? (
        <>
          <Review
            characterId={characterId}
            actionId={activeFocus?.kind === 'frame' ? activeFocus.actionId : undefined}
            frameIndex={activeFocus?.kind === 'frame' ? activeFocus.frameIndex : undefined}
            onSelectFrame={selectFrame}
            onRejectFrame={rejectFrame}
          />
          <Export characterId={characterId} />
          <button
            type="button"
            onClick={() => onOpenPreview(characterId)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:border-slate-400"
          >
            进入试玩
          </button>
        </>
      ) : null}
    </div>
  )
}

/** 把定位压成可比较的字符串，用于判断 URL 里的定位是否真的变了。 */
function serializeFocus(focus: WorkflowEditorFocus | undefined): string {
  if (!focus) return ''
  if (focus.kind === 'step') return `step:${focus.stepId}`
  return `frame:${focus.stepId}:${focus.actionId}:${focus.frameIndex}`
}

function describeFocus(focus: WorkflowEditorFocus): string {
  if (focus.kind === 'step') return `定位步骤 ${focus.stepId}`
  return `定位步骤 ${focus.stepId}／动作 ${focus.actionId} 第 ${focus.frameIndex + 1} 帧`
}
