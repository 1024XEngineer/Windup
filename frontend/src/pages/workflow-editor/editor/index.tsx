import type { ProductionEnginePort } from '@/application/production-engine'
import type { WorkflowRestartPort } from '@/application/workflow-restart'
import type { WorkflowControllerPort } from '@/application/workflow-controller'
import type { ImageUploadPort } from '@/capabilities/image-upload'
import { WORKFLOW_NODE_ORDER } from '@/entities'
import type { WorkflowNodeType, WorkflowRun, WorkflowRunReader } from '@/entities'

const NODE_LABELS: Record<WorkflowNodeType, string> = {
  'character-setup': '角色设置',
  'character-template': '角色模板',
  'template-candidate': '母版选择',
  'action-setup': '动作设置',
  'first-frame': '动作首帧',
  'complete-animation': '完整动画',
  review: '人工审核',
  export: '导出',
}

export interface WorkflowEditorProps {
  /** 路由中的后端 WorkflowRun ID；编辑器通过注入的只读 Repository 恢复。 */
  runId: string
  /** 路由希望展示的阶段；只负责定位，真实推进仍由 workflowController 完成。 */
  activeStage?: string
  /** 以后填充编辑器时沿用的稳定用例与读取端口，不把原始 ImageGenerationPort 暴露给页面。 */
  services: WorkflowEditorServices
}

export interface WorkflowEditorServices {
  workflowRuns: WorkflowRunReader
  productionEngine: ProductionEnginePort
  workflowRestart: WorkflowRestartPort
  workflowController: WorkflowControllerPort
  imageUpload: ImageUploadPort
}

/** 工作流独立页面模块；先从后端形状 Repository 恢复运行，再由后续步骤组件推进。 */
export function WorkflowEditor({ runId, activeStage, services }: WorkflowEditorProps) {
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void services.workflowRuns
      .get(runId)
      .then((value) => {
        if (!active) return
        if (!value) throw new Error(`工作流不存在：${runId}`)
        setRun(value)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '读取工作流失败')
      })
    return () => {
      active = false
    }
  }, [runId, services.workflowRuns])

  const activeNode = run?.revisions
    .find((revision) => revision.id === run.currentRevisionId)
    ?.nodes.find((node) => node.status === 'active')
  const currentStage =
    activeNode?.type ??
    (WORKFLOW_NODE_ORDER.includes(activeStage as WorkflowNodeType)
      ? (activeStage as WorkflowNodeType)
      : undefined)

  async function advance(): Promise<void> {
    try {
      const updated = await services.workflowController.advance(runId)
      setRun(updated)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '推进工作流失败')
    }
  }
  return (
    <div className="space-y-6">
      <section aria-label="工作流阶段" className="border-y border-slate-200 py-4">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WORKFLOW_NODE_ORDER.map((type, index) => (
            <li key={type} className="border border-slate-200 px-3 py-3 text-sm">
              <span className="block text-xs text-slate-400">{index + 1}</span>
              <span className="font-medium">{NODE_LABELS[type]}</span>
              <span className="block text-xs text-slate-400">
                {activeNode?.type === type
                  ? '当前阶段'
                  : activeStage === type
                    ? '路由定位'
                    : (run?.revisions
                        .find((revision) => revision.id === run.currentRevisionId)
                        ?.nodes.find((node) => node.type === type)?.status ?? '等待恢复')}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        <p className="font-medium text-slate-800">工作流运行</p>
        <p className="mt-2">运行标识：{runId}</p>
        {error ? <p className="mt-2 text-red-600">读取失败：{error}</p> : null}
        {!run && !error ? <p className="mt-2">正在恢复工作流…</p> : null}
        {run ? (
          <>
            <p className="mt-2">
              {run.driver === 'manual' ? '手动制作' : 'AI 自动制作'} ·{' '}
              {run.purpose === 'create_character' ? '新建角色' : '已有角色加动作'}
            </p>
            <p className="mt-1">
              当前阶段：{currentStage ? NODE_LABELS[currentStage] : '暂无活动阶段'}
            </p>
            {run.status === 'active' && run.driver === 'manual' ? (
              <button
                type="button"
                onClick={() => void advance()}
                className="mt-4 rounded border border-slate-300 px-3 py-2 text-sm"
              >
                完成当前步骤
              </button>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  )
}
import { useEffect, useState } from 'react'
