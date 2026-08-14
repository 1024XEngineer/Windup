import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'

import { characterApis, projectApis, type Character, type Project } from '@/entities'
import type { Paged } from '@/shared/pagination'
import { EditorialEntryCard, Pagination } from '@/shared/ui'

const PROJECT_PAGE_SIZE = 12

/** 项目中心；项目是角色资产与生成规格的隔离边界。 */
export function ProjectsPage() {
  const [pageNumber, setPageNumber] = useState(1)
  const [projectsPage, setProjectsPage] = useState<Paged<Project> | null>(null)
  const [projectPreviews, setProjectPreviews] = useState<Record<string, string | null>>({})
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setProjectsPage(null)
    setError(null)
    void projectApis.list({ page: pageNumber, pageSize: PROJECT_PAGE_SIZE }).then(
      (page) => {
        if (active) setProjectsPage(page)
      },
      () => {
        if (active) setError('项目暂时无法读取')
      },
    )
    return () => {
      active = false
    }
  }, [pageNumber])

  useEffect(() => {
    let active = true
    if (!projectsPage)
      return () => {
        active = false
      }

    setProjectPreviews(
      Object.fromEntries(projectsPage.items.map((project) => [project.id, project.sampleImageUrl])),
    )
    const projectsWithoutPreview = projectsPage.items.filter((project) => !project.sampleImageUrl)
    void Promise.all(
      projectsWithoutPreview.map(async (project) => {
        try {
          const page = await characterApis.listByProject(project.id, { page: 1, pageSize: 1 })
          return [project.id, previewFromCharacter(page.items[0])] as const
        } catch {
          return [project.id, null] as const
        }
      }),
    ).then((entries) => {
      if (active) setProjectPreviews((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })

    return () => {
      active = false
    }
  }, [projectsPage])

  async function deleteProject(project: Project) {
    setDeleting(true)
    setError(null)
    try {
      await projectApis.remove(project.id)
      if (projectsPage?.items.length === 1 && projectsPage.page > 1) {
        setPageNumber(projectsPage.page - 1)
      } else {
        setProjectsPage((current) =>
          current
            ? {
                ...current,
                items: current.items.filter((item) => item.id !== project.id),
                total: Math.max(0, current.total - 1),
              }
            : current,
        )
      }
      setDeleteTarget(null)
    } catch {
      setError('项目暂时无法删除')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1560px] px-4 pb-8 pt-[clamp(4.75rem,11vh,7rem)] sm:px-6 xl:px-8">
      <section aria-labelledby="projects-title">
        <header data-projects-intro className="projects-intro border-b border-app-line pb-6">
          <h1
            id="projects-title"
            className="font-serif text-[clamp(2.15rem,4.5vw,4rem)] leading-none font-medium tracking-[-0.055em] text-app-ink"
          >
            项目中心
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
            项目隔离角色资产与生成规格；先选项目，再管理其资产。
          </p>
        </header>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-2xl border border-app-danger-line bg-app-danger-soft p-5 text-sm text-app-danger"
          >
            {error}
          </p>
        ) : projectsPage === null ? (
          <p className="mt-6 text-sm text-app-muted">正在读取项目…</p>
        ) : (
          <div className="mt-5">
            <ProjectCreateCard />
            {projectsPage.items.length > 0 ? (
              <ProjectGallery
                projects={projectsPage.items}
                total={projectsPage.total}
                previews={projectPreviews}
                onDelete={setDeleteTarget}
              />
            ) : null}
          </div>
        )}
        {projectsPage ? (
          <Pagination
            page={projectsPage.page}
            pageSize={projectsPage.pageSize}
            total={projectsPage.total}
            onPageChange={setPageNumber}
          />
        ) : null}
      </section>

      {deleteTarget ? (
        <DeleteProjectDialog
          project={deleteTarget}
          pending={deleting}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteProject(deleteTarget)}
        />
      ) : null}
    </div>
  )
}

function previewFromCharacter(character: Character | undefined): string | null {
  if (!character) return null
  for (const outfit of character.outfits) {
    if (outfit.previewUrl) return outfit.previewUrl
  }
  if (character.referenceImageUrl) return character.referenceImageUrl
  for (const outfit of character.outfits) {
    for (const action of outfit.actions) {
      const frame = action.frames.find((item) => item.imageUrl)
      if (frame) return frame.imageUrl
    }
  }
  return null
}

function ProjectCreateCard() {
  return (
    <EditorialEntryCard
      to="/projects/new"
      ariaLabel="新建项目"
      artwork="asset-library"
      title="新建一个项目"
      description="建立角色资产与生成规格的独立生产空间。"
      action="开始建立"
    />
  )
}

function ProjectGallery({
  projects,
  total,
  previews,
  onDelete,
}: {
  projects: Project[]
  total: number
  previews: Record<string, string | null>
  onDelete: (project: Project) => void
}) {
  return (
    <section aria-labelledby="project-gallery-title" className="mt-9">
      <div className="mb-4">
        <h2
          id="project-gallery-title"
          className="text-sm font-medium tracking-[0.04em] text-app-ink"
        >
          最近项目 · {String(total).padStart(2, '0')}
        </h2>
      </div>
      <div className="grid gap-x-4 gap-y-7 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project, index) => (
          <ProjectGalleryTile
            key={project.id}
            project={project}
            previewUrl={previews[project.id] ?? project.sampleImageUrl}
            motionOrder={index}
            onDelete={() => onDelete(project)}
          />
        ))}
      </div>
    </section>
  )
}

function ProjectGalleryTile({
  project,
  previewUrl,
  motionOrder,
  onDelete,
}: {
  project: Project
  previewUrl: string | null
  motionOrder: number
  onDelete: () => void
}) {
  const updatedAt = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(project.updatedAt))

  return (
    <article
      style={{ '--project-card-order': motionOrder } as CSSProperties}
      className="projects-card-enter group/tile relative min-w-0"
    >
      <Link
        to={`/projects/${project.id}/assets`}
        aria-label={`打开项目 ${project.name}`}
        className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ink"
      >
        <div className="relative aspect-[16/10] overflow-hidden rounded-[1.25rem] border border-app-line bg-app-surface-muted transition duration-300 group-hover/tile:-translate-y-0.5 group-hover/tile:border-app-line-strong">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`${project.name}的项目预览`}
              className="h-full w-full object-contain p-6 [image-rendering:pixelated] transition-transform duration-500 group-hover/tile:scale-[1.025]"
            />
          ) : (
            <div className="relative h-full overflow-hidden bg-app-surface-muted">
              <div
                aria-hidden="true"
                className="absolute inset-0 opacity-55"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, var(--color-app-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-app-line) 1px, transparent 1px)',
                  backgroundPosition: 'center center',
                  backgroundSize: '24px 24px',
                }}
              />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-app-surface/85 px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-app-faint backdrop-blur-sm">
                等待第一份角色资产
              </span>
            </div>
          )}
        </div>
        <div className="mt-3 flex min-w-0 items-baseline justify-between gap-4 px-0.5">
          <h3 className="min-w-0 truncate text-sm font-semibold text-app-ink">{project.name}</h3>
          <span className="shrink-0 text-xs tabular-nums text-app-faint">{updatedAt}</span>
        </div>
      </Link>
      <button
        type="button"
        aria-label={`删除项目 ${project.name}`}
        onClick={onDelete}
        className="absolute right-3 top-3 rounded-full border border-app-line bg-app-surface/90 px-2.5 py-1.5 text-sm leading-none text-app-faint opacity-0 backdrop-blur-sm transition hover:text-app-danger group-hover/tile:opacity-100 focus-visible:opacity-100"
      >
        ⋯
      </button>
    </article>
  )
}

function DeleteProjectDialog({
  project,
  pending,
  onClose,
  onConfirm,
}: {
  project: Project
  pending: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  return (
    <div className="projects-dialog-backdrop fixed inset-0 z-50 grid place-items-center bg-app-ink/20 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="删除项目"
        className="projects-dialog-panel w-full max-w-md rounded-[1.5rem] border border-app-line bg-app-surface-raised p-6"
      >
        <h2 className="text-lg font-semibold text-app-ink">删除“{project.name}”？</h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          删除后无法恢复这条项目记录。请先确认项目下资产已经妥善处理。
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded-full border border-app-line px-4 py-2 text-sm disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            aria-label="确认删除项目"
            disabled={pending}
            onClick={() => void onConfirm()}
            className="rounded-full bg-app-danger px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
          >
            {pending ? '正在删除…' : '删除项目'}
          </button>
        </div>
      </section>
    </div>
  )
}
