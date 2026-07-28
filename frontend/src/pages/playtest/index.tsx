import { useNavigate, useParams, useSearchParams } from 'react-router'

import { canImportToPlaytest, getRevision, submitWorkflowCommand, useWorkflowRun } from '@/entities'
import { PageHeader } from '@/shared/ui'
import { InspectionPreview } from './inspection-preview'

export function PlaytestPage() {
  const navigate = useNavigate()
  const { characterId = '' } = useParams()
  const [search] = useSearchParams()
  const runId = search.get('runId')
  const revisionId = search.get('revision')

  return (
    <>
      <PageHeader
        title="核验台"
        subtitle={`角色 ${characterId || '（无）'}`}
        onBack={() => navigate(-1)}
      />
      {!characterId || !runId || !revisionId ? (
        <p className="text-sm text-red-600">缺少角色、工作流或版本参数，无法确定核验来源。</p>
      ) : (
        <PlaytestSession
          characterId={characterId}
          runId={runId}
          revisionId={revisionId}
          onOpenReview={() =>
            navigate(
              `/workflow-editor/${encodeURIComponent(runId)}/review?revision=${encodeURIComponent(revisionId)}`,
            )
          }
        />
      )}
    </>
  )
}

function PlaytestSession({
  characterId,
  runId,
  revisionId,
  onOpenReview,
}: {
  characterId: string
  runId: string
  revisionId: string
  onOpenReview: () => void
}) {
  const query = useWorkflowRun(runId)
  const revision = query.data ? getRevision(query.data, revisionId) : null

  if (query.loading) return <p className="text-sm text-slate-500">加载核验版本…</p>
  if (query.error) return <p className="text-sm text-red-600">加载失败：{query.error.message}</p>
  if (!query.data || !revision)
    return <p className="text-sm text-red-600">指定的历史版本不存在。</p>
  if (!canImportToPlaytest(query.data, revision.id)) {
    return <p className="text-sm text-red-600">该版本尚未通过系统质检，不能导入核验台。</p>
  }

  return (
    <InspectionPreview
      characterId={characterId}
      runId={runId}
      revisionId={revisionId}
      status={revision.playtestStatus}
      onRecordStatus={async (status) => {
        await submitWorkflowCommand(runId, {
          kind: 'record-playtest',
          revisionId,
          status,
        })
        query.refresh()
      }}
      onOpenReview={onOpenReview}
    />
  )
}
