/** 项目列表页：只组织项目级入口，角色资产由 AssetLibrary 页面负责。 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import type { Project, ProjectApis } from '@/entities'

export function ProjectsPage({ apis }: { apis: ProjectApis }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void apis.list().then(
      (page) => active && setProjects(page.items),
      (cause) => active && setError(cause instanceof Error ? cause.message : '项目加载失败'),
    )
    return () => {
      active = false
    }
  }, [apis])

  return (
    <section className="py-8">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-slate-500">PROJECTS</p>
          <h1 className="mt-2 text-3xl font-semibold">项目</h1>
        </div>
        <Link
          className="border border-slate-900 bg-slate-900 px-4 py-2 text-sm text-white"
          to="/projects/new"
        >
          新建项目
        </Link>
      </header>
      {error && (
        <p role="alert" className="border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {!error && projects.length === 0 && (
        <p className="border border-dashed border-slate-300 p-8 text-sm text-slate-500">
          暂无项目。
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((project) => (
          <Link
            key={project.id}
            to={`/projects/${project.id}`}
            className="border border-slate-200 p-5 hover:border-slate-500"
          >
            <h2 className="font-semibold">{project.name}</h2>
            <p className="mt-2 text-xs text-slate-500">
              {project.spriteSize.width} × {project.spriteSize.height} ·{' '}
              {project.directionalMovement}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
