import { useNavigate } from 'react-router'

import { CHARACTER_PERSPECTIVE, useProjects } from '@/entities'
import { PageHeader } from '@/shared/ui'

/** 项目列表。点进去是项目内容页，「开始工作流」在那一页上。 */
export function ProjectsPage() {
  const navigate = useNavigate()
  const { data, loading, error } = useProjects({ page: 1, pageSize: 20 })

  return (
    <>
      <PageHeader title="项目" subtitle="选一个项目开始，或新建一个" />
      {loading ? <p className="text-sm text-slate-400">加载中…</p> : null}
      {error ? <p className="text-sm text-red-500">加载失败：{error.message}</p> : null}
      <ul className="space-y-2">
        {data?.items.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              onClick={() => navigate(`/projects/${project.id}`)}
              className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-slate-400"
            >
              <span className="font-medium">{project.name}</span>
              <span className="ml-3 text-sm text-slate-500">
                {project.spriteSize.width}×{project.spriteSize.height} ·{' '}
                {CHARACTER_PERSPECTIVE[project.perspective]}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data ? <p className="mt-4 text-xs text-slate-400">共 {data.total} 个项目</p> : null}
    </>
  )
}
