import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'

import assetLibraryArtwork from '@/assets/workspace/asset-library.png'
import { projectApis, ProjectHasCharactersError, type Project } from '@/entities'
import type { Paged } from '@/shared/pagination'
import { Pagination, PixelMatrix } from '@/shared/ui'

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
        ) : null}
        {projectsPage === null && !error ? (
          <p className="mt-6 text-sm text-app-muted">正在读取项目…</p>
        ) : null}
        {projectsPage ? (
          <div className="mt-5">
            <ProjectCreateCard />
            {projectsPage.items.length > 0 ? (
              <ProjectGallery
                projects={projectsPage.items}
                total={projectsPage.total}
                onDelete={setDeleteTarget}
              />
            ) : null}
          </div>
        ) : null}
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

function ProjectGallery({
  projects,
  total,
  onDelete,
}: {
  projects: Project[]
  total: number
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
            preview={projectPreview(project)}
            motionOrder={index}
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
  onDelete,
}: {
  project: Project
  preview: ProjectPreviewState
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
          <ProjectPreview projectName={project.name} preview={preview} />
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
      <img
        src={url}
        alt={`${projectName}的项目预览`}
        onLoad={() => setImageState('ready')}
        onError={() => setImageState('error')}
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
