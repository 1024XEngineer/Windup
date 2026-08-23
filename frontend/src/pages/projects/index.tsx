import { DotsThree, PencilSimple, Trash } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'

import assetLibraryArtwork from '@/assets/workspace/asset-library.png'
import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  projectApis,
  ProjectHasCharactersError,
  ProjectNameConflictError,
  type Project,
} from '@/entities'
import type { Paged } from '@/shared/pagination'
import { AssetThumbnailImage, Pagination, PixelMatrix } from '@/shared/ui'

const PROJECT_PAGE_SIZE = 12

/**
 * 卡片预览只有两种落点：后端聚合出了图，或这个项目还没有可用素材。
 * 列表响应已经带上 previewUrl，所以不存在"预览正在请求中"这一态——
 * 图片自身的解码等待由 ProjectPreviewImage 内部处理，别和这里混为一谈。
 */
type ProjectPreviewState = { status: 'ready'; url: string } | { status: 'empty' }

/** 项目中心；项目是角色资产与生成规格的隔离边界。 */
export function ProjectsPage() {
  const [pageNumber, setPageNumber] = useState(1)
  const [projectsPage, setProjectsPage] = useState<Paged<Project> | null>(null)
  const [renameTarget, setRenameTarget] = useState<Project | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
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
    } catch (error) {
      setError(error instanceof ProjectHasCharactersError ? error.message : '项目暂时无法删除')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function renameProject(project: Project, name: string) {
    setRenaming(true)
    setRenameError(null)
    try {
      const renamed = await projectApis.rename(project.id, name)
      setProjectsPage((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === project.id ? { ...renamed, previewUrl: item.previewUrl } : item,
              ),
            }
          : current,
      )
      setRenameTarget(null)
    } catch (error) {
      setRenameError(
        error instanceof ProjectNameConflictError ? error.message : '项目暂时无法重命名',
      )
    } finally {
      setRenaming(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1560px] px-4 pb-8 pt-[4.5rem] sm:px-6 xl:px-8">
      <section aria-label="项目资产">
        <h1 className="sr-only">项目中心</h1>
        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-2xl border border-app-danger-line bg-app-danger-soft p-5 text-sm text-app-danger"
          >
            {error}
          </p>
        ) : null}
        <div>
          <ProjectCreateCard />
          {projectsPage === null && !error ? <ProjectGalleryLoading /> : null}
          {projectsPage && projectsPage.items.length > 0 ? (
            <ProjectGallery
              projects={projectsPage.items}
              total={projectsPage.total}
              onRename={(project) => {
                setRenameError(null)
                setRenameTarget(project)
              }}
              onDelete={setDeleteTarget}
            />
          ) : null}
        </div>
        {projectsPage ? (
          <Pagination
            page={projectsPage.page}
            pageSize={projectsPage.pageSize}
            total={projectsPage.total}
            onPageChange={setPageNumber}
          />
        ) : null}
      </section>

      {renameTarget ? (
        <RenameProjectDialog
          project={renameTarget}
          pending={renaming}
          error={renameError}
          onClose={() => {
            setRenameError(null)
            setRenameTarget(null)
          }}
          onConfirm={(name) => renameProject(renameTarget, name)}
        />
      ) : null}

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

function ProjectCreateCard() {
  return (
    <Link
      to="/projects/new"
      aria-label="新建项目"
      className="group relative block min-h-[13.5rem] overflow-hidden rounded-[1.5rem] border border-app-line bg-transparent p-6 transition duration-300 ease-out hover:-translate-y-0.5 hover:border-app-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ink"
    >
      <div className="relative z-10 flex h-full max-w-[18rem] flex-col">
        <h2 className="font-serif text-[clamp(1.7rem,3vw,2.5rem)] leading-none font-medium tracking-[-0.045em] text-app-ink">
          新建一个项目
        </h2>
        <p className="mt-3 text-sm leading-6 text-app-muted">
          建立角色资产与生成规格的独立生产空间。
        </p>
        <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-app-ink-soft transition-colors group-hover:text-app-accent">
          开始建立 <span aria-hidden="true">→</span>
        </span>
      </div>
      <div className="pointer-events-none absolute -right-3 top-1/2 hidden h-[13.5rem] w-[17rem] -translate-y-1/2 overflow-hidden sm:block">
        <img
          data-testid="projects-asset-artwork"
          src={assetLibraryArtwork}
          alt=""
          aria-hidden="true"
          draggable="false"
          className="absolute h-[17.875rem] w-[17.875rem] max-w-none translate-x-8 rotate-[5deg] object-contain opacity-65 saturate-[0.48] transition duration-500 ease-out group-hover:translate-x-7 group-hover:rotate-[4deg] group-hover:scale-[1.015] group-hover:opacity-75"
          style={{
            imageRendering: 'pixelated',
            left: '-0.75rem',
            top: '-2.2rem',
          }}
        />
      </div>
    </Link>
  )
}

function ProjectGalleryLoading() {
  return (
    <section role="status" aria-label="正在读取项目" aria-busy="true" className="mt-7">
      <h2 aria-hidden="true" className="mb-4 text-sm font-medium tracking-[0.04em] text-app-ink">
        最近项目
      </h2>
      <div
        aria-hidden="true"
        className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      >
        {Array.from({ length: 3 }, (_, index) => (
          <article key={index} data-project-loading-placeholder className="min-w-0">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[1.25rem] border border-app-line bg-app-surface-muted">
              <PixelMatrix coverage="compact" />
            </div>
            <div className="mt-3 flex items-center justify-between gap-4 px-0.5">
              <span className="h-3.5 w-2/5 rounded-sm bg-app-line" />
              <span className="h-3 w-10 rounded-sm bg-app-line" />
            </div>
            <span className="mt-2 block h-3 w-3/5 rounded-sm bg-app-line" />
            <span className="mt-2 block h-2.5 w-2/5 rounded-sm bg-app-line" />
          </article>
        ))}
      </div>
    </section>
  )
}

function ProjectGallery({
  projects,
  total,
  onRename,
  onDelete,
}: {
  projects: Project[]
  total: number
  onRename: (project: Project) => void
  onDelete: (project: Project) => void
}) {
  return (
    <section aria-labelledby="project-gallery-title" className="mt-7">
      <div className="mb-4">
        <h2
          id="project-gallery-title"
          className="text-sm font-medium tracking-[0.04em] text-app-ink"
        >
          最近项目 · {String(total).padStart(2, '0')}
        </h2>
      </div>
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {projects.map((project, index) => (
          <ProjectGalleryTile
            key={project.id}
            project={project}
            preview={projectPreview(project)}
            motionOrder={index}
            onRename={() => onRename(project)}
            onDelete={() => onDelete(project)}
          />
        ))}
      </div>
    </section>
  )
}

function projectPreview(project: Project): ProjectPreviewState {
  const url = project.previewUrl ?? project.sampleImageUrl
  return url ? { status: 'ready', url } : { status: 'empty' }
}

function ProjectGalleryTile({
  project,
  preview,
  motionOrder,
  onRename,
  onDelete,
}: {
  project: Project
  preview: ProjectPreviewState
  motionOrder: number
  onRename: () => void
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
          <ProjectPreview projectName={project.name} preview={preview} />
        </div>
        <div className="mt-3 flex min-w-0 items-baseline justify-between gap-4 px-0.5">
          <h3 className="min-w-0 truncate text-sm font-semibold text-app-ink">{project.name}</h3>
          <span className="shrink-0 text-xs tabular-nums text-app-faint">{updatedAt}</span>
        </div>
        <p className="mt-1.5 truncate px-0.5 text-xs text-app-muted">
          {CHARACTER_PERSPECTIVE[project.perspective]} ·{' '}
          {DIRECTIONAL_MOVEMENT[project.directionalMovement]} · {project.spriteSize.width} ×{' '}
          {project.spriteSize.height} px
        </p>
        <p className="mt-1 truncate px-0.5 font-mono text-[0.65rem] tracking-[0.02em] text-app-faint">
          {project.gameStyle || '未设置游戏风格'}
        </p>
      </Link>
      <ProjectActions project={project} onRename={onRename} onDelete={onDelete} />
    </article>
  )
}

function ProjectActions({
  project,
  onRename,
  onDelete,
}: {
  project: Project
  onRename: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function closeOnOutsidePress(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="absolute right-3 top-3 z-10">
      <button
        type="button"
        aria-label={`项目操作 ${project.name}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="grid h-9 w-9 place-items-center rounded-full border border-app-line bg-app-canvas/95 text-app-ink-soft shadow-sm backdrop-blur-sm transition hover:border-app-line-strong hover:text-app-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ink"
      >
        <DotsThree aria-hidden="true" size={20} weight="bold" />
      </button>
      {open ? (
        <div
          role="group"
          aria-label={`${project.name}的项目操作`}
          className="absolute right-0 top-11 w-36 overflow-hidden rounded-xl border border-app-line bg-app-surface-raised p-1.5 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onRename()
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-ink-soft transition hover:bg-app-surface-muted hover:text-app-ink focus-visible:outline-2 focus-visible:outline-app-ink"
          >
            <PencilSimple aria-hidden="true" size={16} />
            重命名项目
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-app-danger transition hover:bg-app-danger-soft focus-visible:outline-2 focus-visible:outline-app-danger"
          >
            <Trash aria-hidden="true" size={16} />
            删除项目
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ProjectPreview({
  projectName,
  preview,
}: {
  projectName: string
  preview: ProjectPreviewState
}) {
  if (preview.status === 'empty') {
    return (
      <ProjectPreviewMessage projectName={projectName}>等待第一份角色资产</ProjectPreviewMessage>
    )
  }
  return <ProjectPreviewImage key={preview.url} projectName={projectName} url={preview.url} />
}

function ProjectPreviewImage({ projectName, url }: { projectName: string; url: string }) {
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading')

  if (imageState === 'error') {
    return (
      <ProjectPreviewMessage projectName={projectName} tone="error">
        预览图片无法显示
      </ProjectPreviewMessage>
    )
  }

  return (
    <div aria-busy={imageState === 'loading'} className="relative h-full">
      <AssetThumbnailImage
        src={url}
        alt={`${projectName}的项目预览`}
        onLoad={() => setImageState('ready')}
        onError={(event) => {
          if (!event.currentTarget.src.endsWith('.card.webp')) setImageState('error')
        }}
        className={`project-preview-image h-full w-full object-contain p-6 [image-rendering:pixelated] group-hover/tile:scale-[1.025] ${
          imageState === 'ready' ? 'project-preview-image-ready' : ''
        }`}
      />
      {imageState === 'loading' ? <ProjectPreviewLoading projectName={projectName} /> : null}
    </div>
  )
}

/** 只盖在待解码的预览图上；列表响应自带 previewUrl，卡片不会整格停在装载态。 */
function ProjectPreviewLoading({ projectName }: { projectName: string }) {
  return (
    <div
      role="status"
      aria-label={`正在装载${projectName}的项目预览`}
      aria-busy="true"
      className="project-preview-loading absolute inset-0"
    >
      <PixelMatrix coverage="compact" />
    </div>
  )
}

function ProjectPreviewMessage({
  children,
  projectName,
  tone = 'empty',
}: {
  children: string
  projectName: string
  tone?: 'empty' | 'error'
}) {
  return (
    <div
      role="status"
      aria-label={`${projectName}的项目预览：${children}`}
      aria-busy="false"
      className={`project-preview-message ${tone === 'error' ? 'project-preview-message-error' : ''}`}
    >
      <div aria-hidden="true" className="project-preview-message-grid" />
      <span>{children}</span>
    </div>
  )
}

function RenameProjectDialog({
  project,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  project: Project
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(project.name)
  const normalizedName = name.trim()

  return (
    <div className="projects-dialog-backdrop fixed inset-0 z-50 grid place-items-center bg-app-ink/20 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="重命名项目"
        className="projects-dialog-panel w-full max-w-md rounded-[1.5rem] border border-app-line bg-app-surface-raised p-6"
      >
        <h2 className="text-lg font-semibold text-app-ink">重命名项目</h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">项目名称会同步更新到项目中心。</p>
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (normalizedName) void onConfirm(normalizedName)
          }}
        >
          <label className="block text-sm font-medium text-app-ink" htmlFor="project-rename-name">
            项目名称
          </label>
          <input
            id="project-rename-name"
            autoFocus
            required
            maxLength={20}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-xl border border-app-line bg-app-surface px-3.5 py-2.5 text-sm text-app-ink outline-none transition focus:border-app-ink"
          />
          <div className="mt-2 flex items-start justify-between gap-4 text-xs">
            <span role={error ? 'alert' : undefined} className="text-app-danger">
              {error}
            </span>
            <span className="ml-auto shrink-0 text-app-faint">{name.length}/20</span>
          </div>
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
              type="submit"
              aria-label="保存名称"
              disabled={pending || !normalizedName || normalizedName === project.name}
              className="rounded-full bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
            >
              {pending ? '正在保存…' : '保存名称'}
            </button>
          </div>
        </form>
      </section>
    </div>
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
