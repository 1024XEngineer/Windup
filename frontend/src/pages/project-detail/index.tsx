import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  characterApis,
  projectApis,
  type Project,
} from '@/entities'

/** 项目常驻工作区；子路由负责具体资产内容。 */
export function ProjectDetailPage() {
  const { projectId } = useParams()
  const location = useLocation()
  const [project, setProject] = useState<Project | null>(null)
  const [characterCount, setCharacterCount] = useState(0)
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
    void Promise.all([
      projectApis.get(projectId),
      characterApis.listByProject(projectId, { page: 1, pageSize: 1 }),
    ]).then(
      ([nextProject, charactersPage]) => {
        if (!active) return
        setProject(nextProject)
        setCharacterCount(charactersPage.total)
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
      <p
        role="alert"
        className="m-6 rounded-xl border border-[#d8c7bd] bg-[#fff8f2] p-5 text-sm text-[#7a3f2a]"
      >
        {error}
      </p>
    )
  }
  if (!project) return <p className="p-6 text-sm text-[#6f746d]">正在读取项目…</p>

  const constraints = [
    ['视角', CHARACTER_PERSPECTIVE[project.perspective]],
    ['朝向', DIRECTIONAL_MOVEMENT[project.directionalMovement]],
    ['尺寸', `${project.spriteSize.width} × ${project.spriteSize.height}`],
    ['画风', project.gameStyle ?? '尚未设定'],
  ]

  return (
    <div className="grid h-screen gap-3 overflow-hidden bg-[#f7f8f5] p-3 md:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-[#d9ddd6] bg-[#fbfbf8] text-[#222520]">
        <div className="border-b border-[#dfe2dc] px-4 py-4">
          <Link
            to="/projects"
            aria-label="返回项目中心"
            className="text-xs font-medium text-[#687067] hover:text-[#242824]"
          >
            ‹ 项目中心
          </Link>
          <h1 className="mt-3 truncate text-sm font-semibold tracking-[-0.01em]">{project.name}</h1>
        </div>

        <nav aria-label="资产分类" className="p-2.5">
          <p className="px-2 pb-2 pt-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#858c84]">
            资产库
          </p>
          <div className="space-y-0.5">
            <Link
              to={`/projects/${project.id}/assets`}
              aria-current="page"
              className="flex h-9 items-center justify-between rounded-xl bg-[#dfe7dd] px-2.5 text-sm font-semibold text-[#263f2d] transition"
            >
              <span>角色</span>
              <span className="text-xs tabular-nums text-[#7d857d]">{characterCount}</span>
            </Link>
            <button
              type="button"
              disabled
              aria-label="动作模板"
              title="动作模板后端能力不在本期范围"
              className="flex h-9 w-full cursor-not-allowed items-center justify-between rounded-xl px-2.5 text-left text-sm text-[#858c84]"
            >
              <span>动作模板</span>
              <span className="text-[0.62rem] font-medium">后端未提供</span>
            </button>
          </div>
        </nav>

        <div className="mt-2 border-t border-[#e3e6e0] p-3">
          <p className="px-2 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#858c84]">
            项目规格
          </p>
          <dl className="space-y-0.5">
            {constraints.map(([label, value]) => (
              <div
                key={label}
                className="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5 text-[0.7rem]"
              >
                <dt className="text-[#858c84]">{label}</dt>
                <dd className="truncate font-medium text-[#454b44]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>

      <div className="min-w-0 overflow-y-auto">
        <div
          key={location.pathname}
          data-route-transition={location.pathname}
          className="route-transition min-h-full"
        >
          <Outlet />
        </div>
      </div>
    </div>
  )
}
