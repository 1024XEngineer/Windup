import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  SPRITE_SIZES,
  type CharacterPerspective,
  type DirectionalMovement,
  type Project,
} from '@/entities'
import { mockCharacterApis, mockProjectApis } from '@/pages/asset-library/mock'
import { PageContainer } from '@/shared/ui'

/** 项目中心；项目是资产、生成规格与导出的隔离边界。 */
export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [characterCounts, setCharacterCounts] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void mockProjectApis.list().then(
      async (page) => {
        const counts = await Promise.all(
          page.items.map(
            async (project) =>
              [project.id, (await mockCharacterApis.listByProject(project.id)).length] as const,
          ),
        )
        if (!active) return
        setProjects(page.items)
        setCharacterCounts(Object.fromEntries(counts))
      },
      () => {
        if (active) setError('项目暂时无法读取')
      },
    )

    return () => {
      active = false
    }
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredProjects = useMemo(
    () =>
      (projects ?? []).filter((project) =>
        `${project.name}${project.gameStyle ?? ''}`.toLowerCase().includes(normalizedQuery),
      ),
    [normalizedQuery, projects],
  )

  function createProject(input: NewProjectInput) {
    const now = new Date().toISOString()
    const nextProject: Project = {
      id: `project-local-${(projects?.length ?? 0) + 1}`,
      ownerId: 'user-local',
      name: input.name,
      perspective: input.perspective,
      directionalMovement: input.directionalMovement,
      spriteSize: { width: input.spriteSize, height: input.spriteSize },
      gameStyle: input.gameStyle || null,
      sampleImageUrl: null,
      createdAt: now,
      updatedAt: now,
    }
    setProjects((current) => [...(current ?? []), nextProject])
    setCharacterCounts((current) => ({ ...current, [nextProject.id]: 0 }))
    setQuery('')
    setCreateOpen(false)
  }

  return (
    <PageContainer>
      <section aria-labelledby="projects-title">
        <header className="flex flex-col gap-4 border-b border-[#d8dbd4] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[0.65rem] font-semibold tracking-[0.18em] text-[#7b8079]">
              PROJECT WORKSPACE
            </p>
            <h1
              id="projects-title"
              className="mt-2 font-serif text-4xl font-medium tracking-[-0.045em] text-[#1f211e]"
            >
              项目中心
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#696e67]">
              项目隔离角色、动作、生成规格与导出结果；先选项目，再管理其资产。
            </p>
          </div>
          <button
            type="button"
            aria-label="新建项目"
            onClick={() => setCreateOpen(true)}
            className="rounded-full bg-[#263f2d] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#315039]"
          >
            ＋ 新建项目
          </button>
        </header>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full max-w-md">
            <span className="sr-only">搜索项目</span>
            <span aria-hidden="true" className="absolute left-3 top-2.5 text-[#8b9189]">
              ⌕
            </span>
            <input
              type="search"
              aria-label="搜索项目"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目名称或画风"
              className="h-10 w-full rounded-full border border-[#cfd4cc] bg-white pl-9 pr-4 text-sm outline-none placeholder:text-[#989e97] focus:border-[#718076]"
            />
          </label>
          {projects ? (
            <p className="text-xs font-medium text-[#737971]">
              显示 {filteredProjects.length} / {projects.length} 个项目
            </p>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-2xl border border-[#d8c7bd] bg-[#fff8f2] p-5 text-sm text-[#7a3f2a]"
          >
            {error}
          </p>
        ) : projects === null ? (
          <p className="mt-6 text-sm text-[#70766f]">正在读取项目…</p>
        ) : filteredProjects.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[#c9cec6] p-7">
            <h2 className="font-semibold text-[#252a25]">没有匹配的项目</h2>
            <p className="mt-2 text-sm text-[#6d736c]">调整搜索词，或新建一个项目。</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project, index) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={index}
                characterCount={characterCounts[project.id] ?? 0}
                onDelete={() => setDeleteTarget(project)}
              />
            ))}
          </div>
        )}
      </section>

      {createOpen ? (
        <NewProjectDialog onClose={() => setCreateOpen(false)} onCreate={createProject} />
      ) : null}
      {deleteTarget ? (
        <DeleteProjectDialog
          project={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            setProjects((current) => (current ?? []).filter((item) => item.id !== deleteTarget.id))
            setDeleteTarget(null)
          }}
        />
      ) : null}
    </PageContainer>
  )
}

function ProjectCard({
  project,
  index,
  characterCount,
  onDelete,
}: {
  project: Project
  index: number
  characterCount: number
  onDelete: () => void
}) {
  const updatedAt = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(project.updatedAt))
  return (
    <article className="relative min-h-64 rounded-[1.5rem] border border-[#d8dbd4] bg-[#f4f5f1] transition hover:-translate-y-0.5 hover:border-[#9da59b] hover:bg-white">
      <Link
        to={`/projects/${project.id}/assets`}
        aria-label={`打开项目 ${project.name}`}
        className="flex h-full min-h-64 flex-col p-6 pr-14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#252825]"
      >
        <span className="font-mono text-[0.62rem] font-semibold tracking-[0.16em] text-[#8a8f87]">
          PROJECT {String(index + 1).padStart(2, '0')}
        </span>
        <div className="mt-auto pt-10">
          <h2 className="font-serif text-2xl font-medium tracking-[-0.035em] text-[#222520]">
            {project.name}
          </h2>
          <p className="mt-2 text-xs text-[#747b73]">
            {characterCount} 个角色 · 更新于 {updatedAt}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-[#dfe1dc] pt-4 text-xs">
            <div>
              <dt className="text-[#898e87]">视角 / 朝向</dt>
              <dd className="mt-1 font-medium text-[#41473f]">
                {CHARACTER_PERSPECTIVE[project.perspective]} ·{' '}
                {DIRECTIONAL_MOVEMENT[project.directionalMovement]}
              </dd>
            </div>
            <div>
              <dt className="text-[#898e87]">精灵尺寸</dt>
              <dd className="mt-1 font-medium text-[#41473f]">
                {project.spriteSize.width} × {project.spriteSize.height}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[#898e87]">画风约束</dt>
              <dd className="mt-1 truncate font-medium text-[#41473f]">
                {project.gameStyle ?? '尚未设定'}
              </dd>
            </div>
          </dl>
        </div>
      </Link>
      <button
        type="button"
        aria-label={`删除项目 ${project.name}`}
        onClick={onDelete}
        className="absolute right-4 top-4 rounded-full px-2 py-1 text-sm text-[#7a8179] hover:bg-[#eceee9] hover:text-[#7a3f2a]"
      >
        ⋯
      </button>
    </article>
  )
}

interface NewProjectInput {
  name: string
  perspective: CharacterPerspective
  directionalMovement: DirectionalMovement
  spriteSize: number
  gameStyle: string
}

function NewProjectDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (input: NewProjectInput) => void
}) {
  const [name, setName] = useState('')
  const [perspective, setPerspective] = useState<CharacterPerspective>('side')
  const [directionalMovement, setDirectionalMovement] = useState<DirectionalMovement>('four-way')
  const [spriteSize, setSpriteSize] = useState(64)
  const [gameStyle, setGameStyle] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    onCreate({
      name: name.trim(),
      perspective,
      directionalMovement,
      spriteSize,
      gameStyle: gameStyle.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1f241f]/20 p-4 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-label="新建项目"
        onSubmit={submit}
        className="w-full max-w-xl rounded-[1.5rem] border border-[#d4d9d1] bg-white p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-[#252a25]">新建项目</h2>
            <p className="mt-1 text-xs text-[#717971]">
              这些设置将成为角色和动作生成的项目级约束。
            </p>
          </div>
          <button type="button" aria-label="关闭新建项目" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-xs font-medium text-[#596159]">
            项目名称
            <input
              aria-label="项目名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="mt-1.5 h-10 w-full rounded-xl border border-[#cfd4cc] px-3 text-sm outline-none focus:border-[#718076]"
            />
          </label>
          <ProjectSelect
            label="视角"
            value={perspective}
            onChange={setPerspective}
            options={CHARACTER_PERSPECTIVE}
          />
          <ProjectSelect
            label="朝向"
            value={directionalMovement}
            onChange={setDirectionalMovement}
            options={DIRECTIONAL_MOVEMENT}
          />
          <label className="text-xs font-medium text-[#596159]">
            精灵尺寸
            <select
              aria-label="精灵尺寸"
              value={spriteSize}
              onChange={(event) => setSpriteSize(Number(event.target.value))}
              className="mt-1.5 h-10 w-full rounded-xl border border-[#cfd4cc] bg-white px-3 text-sm"
            >
              {SPRITE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} × {size}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[#596159]">
            画风约束
            <input
              aria-label="画风约束"
              value={gameStyle}
              onChange={(event) => setGameStyle(event.target.value)}
              placeholder="例如：低饱和像素绘本"
              className="mt-1.5 h-10 w-full rounded-xl border border-[#cfd4cc] px-3 text-sm outline-none focus:border-[#718076]"
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#cfd4cc] px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            type="submit"
            aria-label="创建项目"
            className="rounded-full bg-[#263f2d] px-4 py-2 text-sm font-semibold text-white"
          >
            创建项目
          </button>
        </div>
      </form>
    </div>
  )
}

function ProjectSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: Record<T, string>
}) {
  return (
    <label className="text-xs font-medium text-[#596159]">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1.5 h-10 w-full rounded-xl border border-[#cfd4cc] bg-white px-3 text-sm"
      >
        {(Object.entries(options) as [T, string][]).map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}

function DeleteProjectDialog({
  project,
  onClose,
  onConfirm,
}: {
  project: Project
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1f241f]/20 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="删除项目"
        className="w-full max-w-md rounded-[1.5rem] border border-[#d9d5cf] bg-white p-6"
      >
        <h2 className="text-lg font-semibold text-[#292b27]">删除“{project.name}”？</h2>
        <p className="mt-2 text-sm leading-6 text-[#6f716c]">
          项目是资产隔离边界；删除后将无法从项目中心访问其角色、动作和导出结果。
        </p>
        <p className="mt-2 text-xs text-[#8a6a5e]">当前为本地演示，不会调用后端删除接口。</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#cfd4cc] px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            type="button"
            aria-label="确认删除项目"
            onClick={onConfirm}
            className="rounded-full bg-[#7a3f2a] px-4 py-2 text-sm font-semibold text-white"
          >
            删除项目
          </button>
        </div>
      </section>
    </div>
  )
}
