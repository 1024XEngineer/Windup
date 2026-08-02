/** 项目详情页：展示项目约束，并把资产与运行记录分成两个明确入口。 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import type { Project, ProjectApis } from '@/entities'

export function ProjectDetailPage({ apis }: { apis: ProjectApis }) {
  const { projectId = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!projectId) return
    void apis.get(projectId).then(
      (value) => active && setProject(value),
      (cause) => active && setError(cause instanceof Error ? cause.message : '项目加载失败'),
    )
    return () => {
      active = false
    }
  }, [apis, projectId])

  return (
    <section className="py-8">
      <p className="text-xs font-semibold text-slate-500">PROJECT</p>
      <h1 className="mt-2 text-3xl font-semibold">{project?.name ?? '项目详情'}</h1>
      {error && (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      )}
      {project && (
        <p className="mt-3 text-sm text-slate-600">
          画布 {project.spriteSize.width} × {project.spriteSize.height}，{project.perspective}，
          {project.directionalMovement}
        </p>
      )}
      <nav className="mt-8 grid gap-3 sm:grid-cols-2" aria-label="项目内容">
        <Link
          to={`/projects/${projectId}/assets`}
          className="border border-slate-200 p-5 hover:border-slate-500"
        >
          <strong>资产库</strong>
          <span className="mt-1 block text-sm text-slate-500">查看已发布的角色、造型和动作</span>
        </Link>
        <Link
          to={`/projects/${projectId}/history`}
          className="border border-slate-200 p-5 hover:border-slate-500"
        >
          <strong>历史记录</strong>
          <span className="mt-1 block text-sm text-slate-500">查看生成运行与版本过程</span>
        </Link>
      </nav>
    </section>
  )
}
