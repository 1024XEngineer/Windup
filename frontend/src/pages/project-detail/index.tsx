import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useParams, useSearchParams } from 'react-router'

import { CHARACTER_PERSPECTIVE, DIRECTIONAL_MOVEMENT, type Project } from '@/entities'
import {
  ExtractedAssetsProvider,
  mockCharacterApis,
  mockProjectApis,
  useExtractedAssets,
} from '@/pages/asset-library/mock'

export function ProjectDetailPage() {
  return (
    <ExtractedAssetsProvider>
      <ProjectWorkspace />
    </ExtractedAssetsProvider>
  )
}

function ProjectWorkspace() {
  const { projectId } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [project, setProject] = useState<Project | null>(null)
  const [characterCount, setCharacterCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const { assets: extractedAssets } = useExtractedAssets()

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
      mockProjectApis.get(projectId),
      mockCharacterApis.listByProject(projectId),
    ]).then(
      ([nextProject, characters]) => {
        if (!active) return
        setProject(nextProject)
        setCharacterCount(characters.length)
      },
      () => {
        if (active) setError('这个项目不存在或暂时无法读取')
      },
    )

    return () => {
      active = false
    }
  }, [projectId])

  if (error)
    return (
      <p
        role="alert"
        className="m-6 rounded-lg border border-[#d8c7bd] bg-[#fff8f2] p-5 text-sm text-[#7a3f2a]"
      >
        {error}
      </p>
    )
  if (!project) return <p className="p-6 text-sm text-[#6f746d]">正在读取项目…</p>

  const constraints = [
    ['视角', CHARACTER_PERSPECTIVE[project.perspective]],
    ['朝向', DIRECTIONAL_MOVEMENT[project.directionalMovement]],
    ['尺寸', `${project.spriteSize.width} × ${project.spriteSize.height}`],
    ['画风', project.gameStyle ?? '尚未设定'],
  ]
  const isCharacterDetail = location.pathname.split('/').length > 5
  const actionCount = extractedAssets.filter((asset) => asset.kind === 'action').length
  const requestedType = searchParams.get('type')
  const activeAsset = isCharacterDetail
    ? 'characters'
    : requestedType === 'actions' && actionCount
      ? 'actions'
      : 'characters'
  const assets = [
    {
      id: 'characters',
      label: '角色',
      count: characterCount,
      href: `/projects/${project.id}/assets`,
    },
    ...(actionCount
      ? [
          {
            id: 'actions',
            label: '动作模板',
            count: actionCount,
            href: `/projects/${project.id}/assets?type=actions`,
          },
        ]
      : []),
  ]
  const activeLabel = activeAsset === 'actions' ? '动作模板' : '角色'
  const query = searchParams.get('q') ?? ''

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
            {assets.map((item) => {
              const active = item.id === activeAsset
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-9 items-center justify-between rounded-xl px-2.5 text-sm transition ${active ? 'bg-[#dfe7dd] font-semibold text-[#263f2d]' : 'text-[#59625a] hover:bg-[#e8ebe6] hover:text-[#2e352f]'}`}
                >
                  <span>{item.label}</span>
                  <span className="text-xs tabular-nums text-[#7d857d]">{item.count}</span>
                </Link>
              )
            })}
          </div>
        </nav>

        {!isCharacterDetail ? (
          <div className="border-t border-[#e3e6e0] p-3">
            <label className="relative block">
              <span className="sr-only">搜索当前资产</span>
              <span aria-hidden="true" className="absolute left-3 top-2 text-[#899087]">
                ⌕
              </span>
              <input
                value={query}
                onChange={(event) => {
                  const next = new URLSearchParams(searchParams)
                  if (event.target.value) next.set('q', event.target.value)
                  else next.delete('q')
                  setSearchParams(next, { replace: true })
                }}
                placeholder={`搜索${activeLabel}`}
                className="h-9 w-full rounded-full border border-[#d5d9d2] bg-white pl-9 pr-3 text-xs outline-none placeholder:text-[#9a9f99] focus:border-[#7a887b]"
              />
            </label>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <button
                type="button"
                aria-label="新建角色"
                className="h-9 rounded-full bg-[#263f2d] px-3 text-xs font-semibold text-white hover:bg-[#315039]"
              >
                ＋ 新建角色
              </button>
              <button
                type="button"
                aria-label="导出全部角色资产"
                className="h-9 rounded-full border border-[#cfd4cc] bg-white px-3 text-xs font-medium text-[#3e473f] hover:bg-[#f5f6f2]"
              >
                导出
              </button>
            </div>
          </div>
        ) : null}

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
        <Outlet />
      </div>
    </div>
  )
}
