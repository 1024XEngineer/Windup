import { useNavigate, useParams, useSearchParams } from 'react-router'

import { PageHeader } from '@/shared/ui'
import { WorkflowEditor } from './editor'
import type { WorkflowEditorFocus } from './editor'

/**
 * Workflow Editor 的路由适配器。
 *
 * 只读 URL、渲染页头和处理跨页跳转；编辑器内部交互属于 ./editor 模块。
 */
export function WorkflowEditorPage() {
  const navigate = useNavigate()
  const { runId = '' } = useParams()
  const [search] = useSearchParams()

  return (
    <>
      <PageHeader title="工作流" subtitle={`运行 ${runId}`} onBack={() => navigate(-1)} />
      <WorkflowEditor
        key={runId}
        runId={runId}
        focus={readFocus(search)}
        onOpenPreview={(characterId) => navigate(`/playtest/${characterId}`)}
      />
    </>
  )
}

/** 只接受完整的定位组合，不把半套或 NaN 参数传进编辑器。 */
function readFocus(search: URLSearchParams): WorkflowEditorFocus | undefined {
  const stepId = search.get('stepId')
  const rawActionId = search.get('actionId')
  const rawFrameIndex = search.get('frameIndex')

  if (!stepId) return undefined
  if (rawActionId === null && rawFrameIndex === null) return { kind: 'step', stepId }
  if (rawActionId === null || rawFrameIndex === null) return undefined

  const actionId = Number(rawActionId)
  const frameIndex = Number(rawFrameIndex)
  if (!Number.isInteger(actionId) || actionId <= 0) return undefined
  if (!Number.isInteger(frameIndex) || frameIndex < 0) return undefined

  return { kind: 'frame', stepId, actionId, frameIndex }
}
