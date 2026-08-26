import { useEffect, useState, type ReactNode } from 'react'
import { Outlet, useParams } from 'react-router'

import { projectApis, type Project } from '@/entities'

/** 项目常驻工作区；子路由负责具体资产内容。 */
export function ProjectDetailPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!projectId) {
      setError('缺少项目 ID')
      return () => {
        active = false
      }
    }

    setProject(null)
    setError(null)
    void projectApis.get(projectId).then(
      (nextProject) => {
        if (active) setProject(nextProject)
      },
      () => {
        if (active) setError('这个项目不存在或暂时无法读取')
      },
    )
    return () => {
      active = false
    }
  }, [projectId])

  if (error) {
    return (
      <ProjectDetailStatus>
        <p
          role="alert"
          className="rounded-xl border border-app-danger-line bg-app-danger-soft p-5 text-sm text-app-danger"
        >
          {error}
        </p>
      </ProjectDetailStatus>
    )
  }
  if (!project) {
    return (
      <ProjectDetailStatus>
        <p className="text-sm text-app-muted">正在读取项目…</p>
      </ProjectDetailStatus>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-app-canvas px-4 pb-8 pt-[4.25rem] text-app-ink sm:px-6 lg:px-8">
      <div className="mx-auto min-h-full w-full max-w-[90rem]">
        <Outlet context={project} />
      </div>
    </div>
  )
}

function ProjectDetailStatus({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-app-canvas px-4 pb-8 pt-[4.25rem] text-app-ink sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[90rem] pt-6">{children}</div>
    </div>
  )
}
