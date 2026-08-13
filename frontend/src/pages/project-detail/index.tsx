import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  CHARACTER_STATUS,
  DIRECTIONAL_MOVEMENT,
  characterApis,
  projectApis,
  type Project,
} from '@/entities'
import { useAuthSession } from '@/features/auth-session'

/** 项目常驻工作区；子路由负责具体资产内容。 */
export function ProjectDetailPage() {
  const { projectId } = useParams()
  const location = useLocation()
  const session = useAuthSession()
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
    setCharacterCount(0)
    setError(null)
    void projectApis.get(projectId).then(
      (nextProject) => {
        if (active) setProject(nextProject)
      },
      () => {
        if (active) setError('这个项目不存在或暂时无法读取')
      },
    )
    void characterApis
      .listByProject(projectId, { page: 1, pageSize: 1, status: CHARACTER_STATUS.PUBLISHED })
      .then(
        (page) => {
          if (active) setCharacterCount(page.total)
        },
        () => undefined,
      )

    return () => {
      active = false
    }
  }, [projectId])

  if (error) {
    return (
      <p
        role="alert"
        className="m-6 rounded-xl border border-app-danger-line bg-app-danger-soft p-5 text-sm text-app-danger"
      >
        {error}
      </p>
    )
  }
  if (!project) return <p className="bg-app-canvas p-6 text-sm text-app-muted">正在读取项目…</p>

  const constraints = [
    ['视角', CHARACTER_PERSPECTIVE[project.perspective]],
    ['朝向', DIRECTIONAL_MOVEMENT[project.directionalMovement]],
    ['尺寸', `${project.spriteSize.width} × ${project.spriteSize.height}`],
    ['画风', project.gameStyle ?? '尚未设定'],
  ]

  function signOut() {
    void session.logout().catch(() => undefined)
  }

  return (
    <div className="grid min-h-screen gap-3 bg-app-canvas p-3 text-app-ink md:h-screen md:grid-cols-[13rem_minmax(0,1fr)] md:overflow-hidden xl:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-app-line bg-app-surface-raised text-app-ink">
        <div className="border-b border-app-line px-4 py-4">
          <Link
            to="/projects"
            aria-label="返回项目中心"
            className="text-xs font-medium text-app-muted hover:text-app-accent"
          >
            ‹ 项目中心
          </Link>
          <h1 className="mt-3 truncate text-sm font-semibold tracking-[-0.01em]">{project.name}</h1>
        </div>

        <nav aria-label="资产分类" className="p-2.5">
          <p className="px-2 pb-2 pt-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-app-faint">
            资产库
          </p>
          <div className="space-y-0.5">
            <Link
              to={`/projects/${project.id}/assets`}
              aria-current="page"
              className="flex h-9 items-center justify-between rounded-xl bg-app-accent-soft px-2.5 text-sm font-semibold text-app-accent transition"
            >
              <span>角色</span>
              <span className="text-xs tabular-nums text-app-muted">{characterCount}</span>
            </Link>
            <button
              type="button"
              disabled
              aria-label="动作模板"
              title="动作模板后端能力不在本期范围"
              className="flex h-9 w-full cursor-not-allowed items-center justify-between rounded-xl px-2.5 text-left text-sm text-app-faint"
            >
              <span>动作模板</span>
              <span className="text-[0.62rem] font-medium">后端未提供</span>
            </button>
          </div>
        </nav>

        <div className="mt-2 border-t border-app-line p-3">
          <p className="px-2 pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-app-faint">
            项目规格
          </p>
          <dl className="space-y-0.5">
            {constraints.map(([label, value]) => (
              <div
                key={label}
                className="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5 text-[0.7rem]"
              >
                <dt className="text-app-faint">{label}</dt>
                <dd className="truncate font-medium text-app-ink-soft">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {session.state.status === 'authenticated' ? (
          <div aria-label="当前账号" className="mt-auto border-t border-app-line p-3">
            <div className="min-w-0 px-2 py-1">
              <p className="truncate text-xs font-semibold text-app-ink-soft">
                {session.state.user.nickname || session.state.user.email}
              </p>
              <p className="mt-0.5 truncate text-[0.68rem] text-app-faint">
                {session.state.user.email}
              </p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-app-line px-3 text-xs font-semibold text-app-muted transition-colors hover:bg-app-accent-muted hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
            >
              退出登录
            </button>
          </div>
        ) : null}
      </aside>

      <div className="min-w-0 overflow-y-auto">
        <div
          key={location.pathname}
          data-route-transition={location.pathname}
          className="route-transition min-h-full"
        >
          <Outlet context={project} />
        </div>
      </div>
    </div>
  )
}
