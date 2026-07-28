import { useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import {
  canEnterNode,
  getFirstAccessibleNodeType,
  getNodeByType,
  getRevision,
  isWorkflowNodeType,
  submitWorkflowCommand,
  useWorkflowRun,
} from '@/entities'
import { PageHeader } from '@/shared/ui'
import { WorkflowEditor } from './editor'

/** Workflow Editor 的 Router 适配器；编辑器本体不读取 URL。 */
export function WorkflowEditorPage() {
  const navigate = useNavigate()
  const { runId = '', stage } = useParams()
  const [search] = useSearchParams()
  const query = useWorkflowRun(runId)
  const requestedRevisionId = search.get('revision')
  const run = query.data
  const revision = run ? getRevision(run, requestedRevisionId ?? run.currentRevisionId) : null
  const requestedType = isWorkflowNodeType(stage) ? stage : null
  const fallbackType = revision ? getFirstAccessibleNodeType(revision) : null
  const activeType =
    run && revision && requestedType && canEnterNode(run, revision.id, requestedType)
      ? requestedType
      : fallbackType

  useEffect(() => {
    if (!run || !revision || !activeType) return
    if (stage === activeType && requestedType) return
    const suffix = requestedRevisionId ? `?revision=${encodeURIComponent(requestedRevisionId)}` : ''
    navigate(`/workflow-editor/${run.id}/${activeType}${suffix}`, { replace: true })
  }, [activeType, navigate, requestedRevisionId, requestedType, revision, run, stage])

  if (query.loading) return <p className="text-sm text-slate-500">加载工作流…</p>
  if (query.error) return <p className="text-sm text-red-600">加载失败：{query.error.message}</p>
  if (!run) return null
  if (!revision) return <p className="text-sm text-red-600">指定的历史版本不存在。</p>
  if (!activeType) return <p className="text-sm text-red-600">工作流没有可访问节点。</p>

  const readOnly = revision.id !== run.currentRevisionId

  return (
    <>
      <PageHeader
        title="工作流"
        subtitle={`${run.id} · ${readOnly ? '历史版本' : '当前版本'}`}
        onBack={() => navigate(-1)}
      />
      <WorkflowEditor
        run={run}
        revision={revision}
        activeType={activeType}
        readOnly={readOnly}
        onSelectNode={(type) => {
          const suffix = readOnly ? `?revision=${encodeURIComponent(revision.id)}` : ''
          navigate(`/workflow-editor/${run.id}/${type}${suffix}`)
        }}
        onOpenRevision={(revisionId) => {
          const target = getRevision(run, revisionId)
          if (!target) return
          const type = getFirstAccessibleNodeType(target)
          const suffix =
            revisionId === run.currentRevisionId
              ? ''
              : `?revision=${encodeURIComponent(revisionId)}`
          navigate(`/workflow-editor/${run.id}/${type}${suffix}`)
        }}
        onRestartNode={async (nodeId) => {
          const updated = await submitWorkflowCommand(run.id, {
            kind: 'restart-from-node',
            sourceRevisionId: revision.id,
            nodeId,
          })
          const nextRevision = getRevision(updated, updated.currentRevisionId)!
          const nextNode = getNodeByType(nextRevision, activeType)
          navigate(
            `/workflow-editor/${updated.id}/${nextNode?.type ?? getFirstAccessibleNodeType(nextRevision)}`,
          )
          query.refresh()
        }}
        onOpenPreview={(characterId) =>
          navigate(
            `/playtest/${encodeURIComponent(characterId)}?runId=${encodeURIComponent(run.id)}` +
              `&revision=${encodeURIComponent(revision.id)}`,
          )
        }
      />
    </>
  )
}
