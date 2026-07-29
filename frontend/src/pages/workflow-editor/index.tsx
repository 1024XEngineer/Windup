import { useNavigate, useParams } from 'react-router'

import { PageHeader } from '@/shared/ui'
import { WorkflowEditor } from './editor'
import type { WorkflowEditorServices } from './editor'

export interface WorkflowEditorPageProps {
  services: WorkflowEditorServices
}

/** Workflow Editor 的路由外壳；真实数据由未来应用服务注入。 */
export function WorkflowEditorPage({ services }: WorkflowEditorPageProps) {
  const navigate = useNavigate()
  const { runId = '', stage } = useParams()

  return (
    <>
      <PageHeader title="工作流" subtitle={runId || '未指定运行'} onBack={() => navigate(-1)} />
      {runId ? (
        <WorkflowEditor runId={runId} activeStage={stage} services={services} />
      ) : (
        <p className="text-sm text-red-600">缺少工作流运行标识。</p>
      )}
    </>
  )
}
