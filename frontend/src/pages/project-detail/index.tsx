import { useNavigate, useParams } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  createWorkflowRun,
  useProject,
} from '@/entities'
import { PageHeader } from '@/shared/ui'

/**
 * 单个项目的内容浏览：项目约束 + 项目下的全部内容（一期只角色，后续加动作模板、穿戴）。
 * 与项目列表是两页，07-22 会议要求两页都要有。
 */
export function ProjectDetailPage() {
  const navigate = useNavigate()
  const { projectId = '' } = useParams()
  const { data: project, loading, error } = useProject(projectId)

  async function start() {
    const run = await createWorkflowRun({ projectId, driver: 'manual' })
    navigate(`/workflow-editor/${run.id}/asset`)
  }

  return (
    <>
      <PageHeader
        title={project?.name ?? '项目'}
        subtitle={project ? `项目 ${project.id}` : undefined}
        onBack={() => navigate('/projects')}
        actions={
          project ? (
            <button
              type="button"
              onClick={() => void start()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
            >
              开始工作流
            </button>
          ) : null
        }
      />
      {loading ? <p className="text-sm text-slate-400">加载中…</p> : null}
      {error ? <p className="text-sm text-red-500">加载失败：{error.message}</p> : null}
      {project ? (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <dt className="text-slate-500">精灵尺寸</dt>
            <dd>
              {project.spriteSize.width}×{project.spriteSize.height}
            </dd>
            <dt className="text-slate-500">视角</dt>
            <dd>{CHARACTER_PERSPECTIVE[project.perspective]}</dd>
            <dt className="text-slate-500">移动方向</dt>
            <dd>{DIRECTIONAL_MOVEMENT[project.directionalMovement]}</dd>
            <dt className="text-slate-500">画风</dt>
            <dd>{project.gameStyle ?? '未设置'}</dd>
          </dl>
          <p className="text-sm text-slate-400">
            待实现：本项目下的角色列表，以及跳转到项目资产库。
          </p>
          <button
            type="button"
            onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}/assets`)}
            className="mt-3 rounded-lg border border-slate-200 px-4 py-2 text-sm hover:border-slate-400"
          >
            查看本项目资产库
          </button>
        </>
      ) : null}
    </>
  )
}
