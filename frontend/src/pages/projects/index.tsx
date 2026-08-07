import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'

import { CHARACTER_PERSPECTIVE, DIRECTIONAL_MOVEMENT, projectApis, type Project } from '@/entities'
import type { Paged } from '@/shared/pagination'
import { PageContainer, Pagination } from '@/shared/ui'

const PROJECT_PAGE_SIZE = 12

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
    } catch {
      setError('项目暂时无法删除')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <PageContainer>
      <section aria-labelledby="projects-title">
        <header
          data-projects-intro
          className="projects-intro flex flex-col gap-4 border-b border-[#d8dbd4] pb-6 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <h1
              id="projects-title"
              className="font-serif text-4xl font-medium tracking-[-0.045em] text-[#1f211e]"
            >
              项目中心
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#696e67]">
              项目隔离角色资产与生成规格；先选项目，再管理其资产。
            </p>
          </div>
          <button
            type="button"
            aria-label="新建项目"
            disabled
            title="新建项目流程不在本模块中"
            className="cursor-not-allowed rounded-full border border-[#cbd1c8] px-5 py-2.5 text-sm font-semibold text-[#858c84]"
          >
            ＋ 新建项目
          </button>
        </header>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-2xl border border-[#d8c7bd] bg-[#fff8f2] p-5 text-sm text-[#7a3f2a]"
          >
            {error}
          </p>
        ) : projectsPage === null ? (
          <p className="mt-6 text-sm text-[#70766f]">正在读取项目…</p>
        ) : projectsPage.total === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[#c9cec6] p-7">
            <h2 className="font-semibold text-[#252a25]">还没有项目</h2>
            <p className="mt-2 text-sm text-[#6d736c]">完成新建项目流程后，项目会显示在这里。</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projectsPage.items.map((project, index) => (
              <ProjectCard
                key={project.id}
                project={project}
                motionOrder={index}
                onDelete={() => setDeleteTarget(project)}
              />
            ))}
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
    </PageContainer>
  )
}

function ProjectCard({
  project,
  motionOrder,
  onDelete,
}: {
  project: Project
  motionOrder: number
  onDelete: () => void
}) {
  const updatedAt = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(project.updatedAt))

  return (
    <article
      data-project-card
      style={{ '--project-card-order': motionOrder } as CSSProperties}
      className="projects-card-enter relative min-h-64 rounded-[1.5rem] border border-[#d8dbd4] bg-[#f4f5f1] transition duration-300 ease-out hover:-translate-y-0.5 hover:border-[#9da59b] hover:bg-white"
    >
      <Link
        to={`/projects/${project.id}/assets`}
        aria-label={`打开项目 ${project.name}`}
        className="flex h-full min-h-64 flex-col p-6 pr-14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#252825]"
      >
        <div className="mt-auto pt-10">
          <h2 className="font-serif text-2xl font-medium tracking-[-0.035em] text-[#222520]">
            {project.name}
          </h2>
          <p className="mt-2 text-xs text-[#747b73]">更新于 {updatedAt}</p>
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
    <div className="projects-dialog-backdrop fixed inset-0 z-50 grid place-items-center bg-[#1f241f]/20 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="删除项目"
        className="projects-dialog-panel w-full max-w-md rounded-[1.5rem] border border-[#d9d5cf] bg-white p-6"
      >
        <h2 className="text-lg font-semibold text-[#292b27]">删除“{project.name}”？</h2>
        <p className="mt-2 text-sm leading-6 text-[#6f716c]">
          删除后无法恢复这条项目记录。请先确认项目下资产已经妥善处理。
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded-full border border-[#cfd4cc] px-4 py-2 text-sm disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            aria-label="确认删除项目"
            disabled={pending}
            onClick={() => void onConfirm()}
            className="rounded-full bg-[#7a3f2a] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? '正在删除…' : '删除项目'}
          </button>
        </div>
      </section>
    </div>
  )
}
