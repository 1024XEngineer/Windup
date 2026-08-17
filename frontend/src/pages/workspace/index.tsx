import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import {
  characterApis,
  getOutfitPlayback,
  projectApis,
  workflowRunApis,
  type Character,
  type Project,
  type WorkflowRun,
} from '@/entities'
import type { Paged } from '@/shared/pagination'
import { Pagination } from '@/shared/ui'

import { WorkspaceEntranceVisual } from './visuals'
import './workspace.css'

const CONTEXT_PAGE_SIZE = 4

type WorkspaceMode = 'playtest' | 'projects' | 'workflow'

function formatProjectDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function workflowName(run: WorkflowRun) {
  const setup = run.nodes.find((node) => node.type === 'character-setup')
  return setup?.type === 'character-setup' && setup.input.name
    ? setup.input.name
    : `工作流 #${run.id}`
}

function workflowProgress(run: WorkflowRun) {
  return run.nodes.filter((node) => node.status === 'passed').length
}

function contextTitle(mode: WorkspaceMode) {
  if (mode === 'workflow') return '选择工作流'
  if (mode === 'playtest') return '选择可预览造型'
  return '最近项目'
}

function contextDescription(mode: WorkspaceMode) {
  if (mode === 'workflow') return '先定位项目，再继续一条真实的制作流程。'
  if (mode === 'playtest') return '按项目、角色和造型逐层定位可预览资产。'
  return '从最近更新的真实项目回到角色资产与制作现场。'
}

export function WorkspacePage() {
  const [projects, setProjects] = useState<Paged<Project> | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectPage, setProjectPage] = useState(1)
  const [projectRequestVersion, setProjectRequestVersion] = useState(0)
  const [mode, setMode] = useState<WorkspaceMode>('projects')
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [workflowRuns, setWorkflowRuns] = useState<Paged<WorkflowRun> | null>(null)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [workflowPage, setWorkflowPage] = useState(1)
  const [workflowRequestVersion, setWorkflowRequestVersion] = useState(0)
  const [characters, setCharacters] = useState<Paged<Character> | null>(null)
  const [charactersError, setCharactersError] = useState<string | null>(null)
  const [characterPage, setCharacterPage] = useState(1)
  const [characterRequestVersion, setCharacterRequestVersion] = useState(0)
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null)
  const [outfitPage, setOutfitPage] = useState(1)

  useEffect(() => {
    let active = true
    setProjects(null)
    setProjectsError(null)
    void projectApis.list({ page: projectPage, pageSize: CONTEXT_PAGE_SIZE }).then(
      (page) => {
        if (active) setProjects(page)
      },
      () => {
        if (active) setProjectsError('项目暂时无法读取')
      },
    )
    return () => {
      active = false
    }
  }, [projectPage, projectRequestVersion])

  useEffect(() => {
    if (mode !== 'workflow' || selectedProject === null) return
    let active = true
    setWorkflowRuns(null)
    setWorkflowError(null)
    void workflowRunApis
      .listByProject(selectedProject.id, {
        page: workflowPage,
        pageSize: CONTEXT_PAGE_SIZE,
      })
      .then(
        (page) => {
          if (active) setWorkflowRuns(page)
        },
        () => {
          if (active) setWorkflowError('工作流暂时无法读取')
        },
      )
    return () => {
      active = false
    }
  }, [mode, selectedProject, workflowPage, workflowRequestVersion])

  useEffect(() => {
    if (mode !== 'playtest' || selectedProject === null) return
    let active = true
    setCharacters(null)
    setCharactersError(null)
    void characterApis
      .listByProject(selectedProject.id, {
        page: characterPage,
        pageSize: CONTEXT_PAGE_SIZE,
      })
      .then(
        (page) => {
          if (active) setCharacters(page)
        },
        () => {
          if (active) setCharactersError('角色资产暂时无法读取')
        },
      )
    return () => {
      active = false
    }
  }, [characterPage, characterRequestVersion, mode, selectedProject])

  function selectMode(nextMode: Exclude<WorkspaceMode, 'projects'>) {
    setMode(nextMode)
    setProjectPage(1)
    setSelectedProject(null)
    setWorkflowRuns(null)
    setWorkflowError(null)
    setWorkflowPage(1)
    setCharacters(null)
    setCharactersError(null)
    setCharacterPage(1)
    setSelectedCharacter(null)
    setOutfitPage(1)
  }

  function chooseWorkflowProject(project: Project) {
    setSelectedProject(project)
    setWorkflowPage(1)
  }

  function choosePlaytestProject(project: Project) {
    setSelectedProject(project)
    setSelectedCharacter(null)
    setCharacterPage(1)
    setOutfitPage(1)
  }

  function resetWorkflowProject() {
    setSelectedProject(null)
    setWorkflowRuns(null)
    setWorkflowError(null)
    setWorkflowPage(1)
  }

  function resetPlaytestProject() {
    setSelectedProject(null)
    setCharacters(null)
    setCharactersError(null)
    setCharacterPage(1)
    setSelectedCharacter(null)
    setOutfitPage(1)
  }

  const title = contextTitle(mode)
  let contextContent: ReactNode
  if (projectsError !== null) {
    contextContent = (
      <ErrorState
        title={projectsError}
        description="检查网络后重试，或先用快速开始建立新的制作流程。"
        retryLabel="重试读取项目"
        onRetry={() => setProjectRequestVersion((version) => version + 1)}
      >
        <ContextLink to="/quick-start">快速开始</ContextLink>
      </ErrorState>
    )
  } else if (projects === null) {
    contextContent = <LoadingState label="正在读取项目…" />
  } else if (projects.total === 0) {
    contextContent = (
      <EmptyState
        title="还没有项目"
        description="先建立一个项目，角色、工作流和可预览造型才会有归属。"
      >
        <PrimaryContextLink to="/projects/new" aria-label="新建项目">
          新建项目
        </PrimaryContextLink>
        <ContextLink to="/quick-start" aria-label="从快速开始创建">
          从快速开始创建
        </ContextLink>
      </EmptyState>
    )
  } else if (mode === 'workflow') {
    contextContent =
      selectedProject === null ? (
        <ProjectSelection
          projects={projects}
          onPageChange={setProjectPage}
          onSelect={chooseWorkflowProject}
        />
      ) : (
        <div className="space-y-4">
          <SelectedContext
            label="项目"
            value={selectedProject.name}
            actionLabel="重新选择项目"
            onReset={resetWorkflowProject}
          />
          {workflowError !== null ? (
            <ErrorState
              title={workflowError}
              description="重试读取，或先回项目资产检查当前内容。"
              retryLabel="重试读取工作流"
              onRetry={() => setWorkflowRequestVersion((version) => version + 1)}
            />
          ) : workflowRuns === null ? (
            <LoadingState label="正在读取工作流…" />
          ) : workflowRuns.total === 0 ? (
            <EmptyState
              title="这个项目还没有工作流"
              description="通过快速开始建立一条真实流程，或先整理项目资产。"
            >
              <PrimaryContextLink to="/quick-start" aria-label="通过快速开始建立流程">
                通过快速开始建立流程
              </PrimaryContextLink>
              <ContextLink
                to={`/projects/${selectedProject.id}/assets`}
                aria-label="查看当前项目资产"
              >
                查看项目资产
              </ContextLink>
            </EmptyState>
          ) : (
            <WorkflowSelection runs={workflowRuns} onPageChange={setWorkflowPage} />
          )}
          {workflowRuns?.total !== 0 ? (
            <ContextFooter>
              <ContextLink
                to={`/projects/${selectedProject.id}/assets`}
                aria-label="查看当前项目资产"
              >
                查看项目资产
              </ContextLink>
            </ContextFooter>
          ) : null}
        </div>
      )
  } else if (mode === 'playtest') {
    contextContent =
      selectedProject === null ? (
        <div className="space-y-5">
          <ProjectSelection
            projects={projects}
            onPageChange={setProjectPage}
            onSelect={choosePlaytestProject}
          />
          <ContextFooter>
            <ContextLink to="/playtest" aria-label="查看全部可预览资产">
              查看全部可预览资产
            </ContextLink>
          </ContextFooter>
        </div>
      ) : (
        <div className="space-y-4">
          <SelectedContext
            label="项目"
            value={selectedProject.name}
            actionLabel="重新选择项目"
            onReset={resetPlaytestProject}
          />
          {charactersError !== null ? (
            <ErrorState
              title={charactersError}
              description="重试读取，或先回项目资产检查角色数据。"
              retryLabel="重试读取角色"
              onRetry={() => setCharacterRequestVersion((version) => version + 1)}
            />
          ) : characters === null ? (
            <LoadingState label="正在读取角色…" />
          ) : characters.total === 0 ? (
            <EmptyState
              title="这个项目还没有角色"
              description="先在项目里完成角色与动作制作，再进入预览台。"
            />
          ) : selectedCharacter === null ? (
            <CharacterSelection
              characters={characters}
              onPageChange={setCharacterPage}
              onSelect={(character) => {
                setSelectedCharacter(character)
                setOutfitPage(1)
              }}
            />
          ) : (
            <div className="space-y-4">
              <SelectedContext
                label="角色"
                value={selectedCharacter.name ?? '未命名角色'}
                actionLabel="重新选择角色"
                onReset={() => {
                  setSelectedCharacter(null)
                  setOutfitPage(1)
                }}
              />
              {selectedCharacter.outfits.length === 0 ? (
                <EmptyState
                  title="这个角色还没有造型"
                  description="先回项目资产完成造型与动作制作，再进入预览台。"
                />
              ) : (
                <OutfitSelection
                  character={selectedCharacter}
                  page={outfitPage}
                  onPageChange={setOutfitPage}
                />
              )}
            </div>
          )}
          <ContextFooter>
            <ContextLink
              to={`/projects/${selectedProject.id}/assets`}
              aria-label="查看当前项目资产"
            >
              查看项目资产
            </ContextLink>
            <ContextLink to="/playtest" aria-label="查看全部可预览资产">
              查看全部可预览资产
            </ContextLink>
          </ContextFooter>
        </div>
      )
  } else {
    contextContent = <ResumeProjects projects={projects.items} />
  }

  return (
    <div className="workspace-page h-svh overflow-hidden">
      <div className="workspace-shell mx-auto flex h-full w-full max-w-[1560px] flex-col px-4 sm:px-6 xl:px-8">
        <header className="mb-3 shrink-0 sm:mb-4">
          <h1 className="font-serif text-[clamp(2.15rem,4.5vw,4rem)] leading-none font-medium tracking-[-0.055em] text-app-ink">
            工作台
          </h1>
          <p className="mt-2 text-sm leading-6 text-app-muted">从这里开始，去任何地方</p>
        </header>

        <div className="workspace-layout grid min-h-0 flex-1 grid-cols-1 gap-[clamp(1rem,3vw,3rem)] md:grid-cols-[minmax(0,1.12fr)_minmax(16rem,0.88fr)]">
          <section
            aria-label="工作入口"
            className="grid min-h-0 grid-cols-2 grid-rows-2 gap-x-[clamp(0.75rem,2vw,1.5rem)] gap-y-[clamp(0.25rem,1vh,0.75rem)]"
          >
            <DirectEntranceCard
              to="/quick-start"
              ariaLabel="进入快速开始"
              kind="quick-start"
              title="快速开始"
              description="用自然语言建立角色、造型与动作的标准生产流程。"
            />
            <WorkflowEntranceCard
              selected={mode === 'workflow'}
              onContinue={() => selectMode('workflow')}
            />
            <DirectEntranceCard
              to="/projects"
              ariaLabel="进入资产库"
              kind="asset"
              title="资产库"
              description="按项目整理角色、造型、动作与逐帧资产。"
            />
            <SelectableEntranceCard
              ariaLabel="选择预览台"
              kind="playtest"
              title="预览台"
              description="选择已有造型，核验移动与动画播放。"
              selected={mode === 'playtest'}
              onClick={() => selectMode('playtest')}
            />
          </section>

          <aside
            aria-labelledby="workspace-context-title"
            className="flex min-h-0 flex-col overflow-hidden max-md:hidden"
          >
            <header className="shrink-0 pb-3 sm:pb-4">
              <div>
                <h2
                  id="workspace-context-title"
                  className="font-sans text-[clamp(1.2rem,2.2vw,1.65rem)] leading-none font-semibold tracking-[-0.025em] text-app-ink"
                >
                  {title}
                </h2>
              </div>
              {mode === 'projects' ? null : (
                <p className="mt-2 max-w-md text-xs leading-5 text-app-muted">
                  {contextDescription(mode)}
                </p>
              )}
            </header>

            <div
              key={`${mode}:${selectedProject?.id ?? 'none'}:${selectedCharacter?.id ?? 'none'}`}
              aria-live="polite"
              className="workspace-context-enter min-h-0 flex-1 overflow-y-auto py-1"
            >
              {contextContent}
            </div>

            {mode === 'projects' && projects !== null && projects.total > 0 ? (
              <ContextFooter className="shrink-0 pt-3">
                <ContextLink to="/projects" aria-label="查看全部项目">
                  查看全部项目
                </ContextLink>
                <PrimaryContextLink to="/projects/new" aria-label="新建项目">
                  新建项目
                </PrimaryContextLink>
              </ContextFooter>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  )
}

interface EntranceCardProps {
  ariaLabel: string
  description: string
  kind: 'asset' | 'playtest' | 'quick-start' | 'workflow'
  title: string
}

const entranceCardClass =
  'workspace-entrance-card group relative flex h-full min-h-0 w-full flex-col overflow-hidden p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent'

function EntranceCardContent({
  description,
  kind,
  selected = false,
  title,
}: Omit<EntranceCardProps, 'ariaLabel'> & { selected?: boolean }) {
  return (
    <>
      <div className="relative min-h-0 flex-[1.35] overflow-hidden px-2 text-app-accent">
        <WorkspaceEntranceVisual kind={kind} selected={selected} />
      </div>
      <div className="flex shrink-0 items-end justify-between gap-3 px-2 pb-3">
        <div>
          <h3 className="font-serif text-[clamp(1.05rem,2.2vw,1.5rem)] leading-tight font-medium tracking-[-0.035em] text-app-ink">
            {title}
          </h3>
          <p className="mt-1 max-w-xs text-[clamp(0.65rem,1.05vw,0.75rem)] leading-[1.55] text-app-muted">
            {description}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={`grid h-8 w-8 shrink-0 place-items-center text-lg transition-colors ${
            selected ? 'text-app-accent' : 'text-app-faint group-hover:text-app-accent'
          }`}
        >
          {selected ? '✓' : '↗'}
        </span>
      </div>
    </>
  )
}

function DirectEntranceCard({
  ariaLabel,
  description,
  kind,
  title,
  to,
}: EntranceCardProps & { to: string }) {
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className={`${entranceCardClass} bg-transparent hover:bg-app-surface-raised/28`}
    >
      <EntranceCardContent kind={kind} title={title} description={description} />
    </Link>
  )
}

function SelectableEntranceCard({
  ariaLabel,
  description,
  kind,
  onClick,
  selected,
  title,
}: EntranceCardProps & { onClick: () => void; selected: boolean }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={onClick}
      className={`${entranceCardClass} ${
        selected ? 'bg-app-surface-raised/42' : 'bg-transparent hover:bg-app-surface-raised/28'
      }`}
    >
      <EntranceCardContent
        kind={kind}
        title={title}
        description={description}
        selected={selected}
      />
    </button>
  )
}

function WorkflowEntranceCard({
  onContinue,
  selected,
}: {
  onContinue: () => void
  selected: boolean
}) {
  return (
    <div
      className={`${entranceCardClass} workflow-entrance-card group ${
        selected ? 'bg-app-surface-raised/42' : 'bg-transparent'
      }`}
    >
      <div className="relative min-h-0 flex-[1.35] overflow-hidden px-2 text-app-accent">
        <WorkspaceEntranceVisual kind="workflow" selected={selected} />
      </div>
      <div className="relative h-[5.4rem] shrink-0 px-2 pb-3">
        <div className="workflow-card-copy flex h-full items-end justify-between gap-3">
          <div>
            <h3 className="font-serif text-[clamp(1.05rem,2.2vw,1.5rem)] leading-tight font-medium tracking-[-0.035em] text-app-ink">
              工作流画布
            </h3>
            <p className="mt-1 text-[clamp(0.65rem,1.05vw,0.75rem)] leading-[1.55] text-app-muted">
              新建制作流程，或继续已有进度。
            </p>
          </div>
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center text-lg text-app-faint"
          >
            {selected ? '✓' : '↗'}
          </span>
        </div>
        <div
          className="workflow-card-actions absolute inset-x-2 top-0 bottom-3 grid grid-rows-2"
          aria-label="工作流画布入口"
        >
          <Link
            to="/projects/new?entry=workflow-editor"
            aria-label="创建新项目"
            className="workflow-card-action workflow-card-action-create group/action flex items-center justify-between text-left focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          >
            <strong className="font-serif text-[clamp(0.9rem,1.5vw,1.1rem)] font-medium tracking-[-0.025em] text-app-ink">
              创建新项目
            </strong>
            <span
              aria-hidden="true"
              className="text-sm text-app-muted transition-transform group-hover/action:translate-x-0.5"
            >
              ↗
            </span>
          </Link>
          <button
            type="button"
            aria-label="继续已有工作流"
            aria-pressed={selected}
            onClick={onContinue}
            className="workflow-card-action workflow-card-action-continue group/action flex items-center justify-between text-left focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          >
            <strong className="font-serif text-[clamp(0.9rem,1.5vw,1.1rem)] font-medium tracking-[-0.025em] text-app-ink">
              继续已有工作流
            </strong>
            <span
              aria-hidden="true"
              className="text-sm text-app-muted transition-transform group-hover/action:translate-x-0.5"
            >
              →
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ResumeProjects({ projects }: { projects: Project[] }) {
  return (
    <div>
      <div className="mb-2 flex min-h-9 items-center justify-between rounded-[0.625rem] bg-app-surface-muted px-3 font-sans text-[0.65rem] font-medium tracking-[0.02em] text-app-muted">
        <span>{projects.length} 个项目</span>
        <span>项目列表</span>
      </div>
      <div className="grid gap-1">
        {projects.map((project) => (
          <Link
            key={project.id}
            to={`/projects/${project.id}/assets`}
            aria-label={`打开项目 ${project.name}`}
            className="group flex items-center justify-between gap-4 rounded-md px-3 py-3 font-sans transition-colors hover:bg-app-surface-raised/55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          >
            <span className="min-w-0">
              <strong className="block truncate text-[0.95rem] font-semibold tracking-[-0.015em] text-app-ink">
                {project.name}
              </strong>
              <span className="mt-0.5 block text-[0.68rem] text-app-faint">
                {formatProjectDate(project.updatedAt)} 更新
              </span>
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-sm text-app-faint group-hover:text-app-accent"
            >
              ↗
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

interface ProjectSelectionProps {
  onPageChange: (page: number) => void
  onSelect: (project: Project) => void
  projects: Paged<Project>
}

function ProjectSelection({ onPageChange, onSelect, projects }: ProjectSelectionProps) {
  return (
    <div>
      <p className="mb-3 text-xs leading-5 text-app-muted">选择这次工作的项目边界。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.items.map((project) => (
          <button
            key={project.id}
            type="button"
            aria-label={`选择项目 ${project.name}`}
            onClick={() => onSelect(project)}
            className="group min-h-24 rounded-[1.1rem] border border-app-line bg-app-surface-raised px-4 py-3 text-left transition hover:border-app-line-strong hover:bg-app-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          >
            <span className="flex items-center justify-between gap-3 text-[0.62rem] text-app-faint">
              PROJECT · {project.id}
              <span aria-hidden="true" className="text-sm group-hover:text-app-accent">
                →
              </span>
            </span>
            <strong className="mt-4 block font-serif text-lg font-medium tracking-[-0.025em] text-app-ink">
              {project.name}
            </strong>
          </button>
        ))}
      </div>
      <Pagination
        page={projects.page}
        pageSize={projects.pageSize}
        total={projects.total}
        onPageChange={onPageChange}
      />
    </div>
  )
}

function WorkflowSelection({
  onPageChange,
  runs,
}: {
  onPageChange: (page: number) => void
  runs: Paged<WorkflowRun>
}) {
  return (
    <div>
      <div className="space-y-3">
        {runs.items.map((run) => {
          const completed = workflowProgress(run)
          const total = run.nodes.length
          const percentage = total === 0 ? 0 : Math.round((completed / total) * 100)
          const name = workflowName(run)
          return (
            <Link
              key={run.id}
              to={`/workflow-editor/${run.id}`}
              aria-label={`打开工作流 ${name}`}
              className="group block rounded-[1.15rem] border border-app-line bg-app-surface-raised p-4 transition hover:border-app-line-strong hover:bg-app-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            >
              <span className="flex items-center justify-between gap-3 font-mono text-[0.6rem] font-semibold tracking-[0.08em] text-app-faint uppercase">
                WorkflowRun #{run.id}
                <span aria-hidden="true" className="text-sm group-hover:text-app-accent">
                  ↗
                </span>
              </span>
              <strong className="mt-2 block font-serif text-xl font-medium tracking-[-0.03em] text-app-ink">
                {name}
              </strong>
              <span className="mt-4 flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-app-surface-muted">
                  <span
                    className="block h-full rounded-full bg-app-accent"
                    style={{ width: `${percentage}%` }}
                  />
                </span>
                <span className="shrink-0 text-[0.68rem] text-app-muted">
                  {completed} / {total} 节点完成
                </span>
              </span>
            </Link>
          )
        })}
      </div>
      <Pagination
        page={runs.page}
        pageSize={runs.pageSize}
        total={runs.total}
        onPageChange={onPageChange}
      />
    </div>
  )
}

function CharacterSelection({
  characters,
  onPageChange,
  onSelect,
}: {
  characters: Paged<Character>
  onPageChange: (page: number) => void
  onSelect: (character: Character) => void
}) {
  return (
    <div>
      <p className="mb-3 text-xs leading-5 text-app-muted">选择要核验的角色。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {characters.items.map((character) => {
          const name = character.name ?? '未命名角色'
          return (
            <button
              key={character.id}
              type="button"
              aria-label={`选择角色 ${name}`}
              onClick={() => onSelect(character)}
              className="group min-h-24 rounded-[1.1rem] border border-app-line bg-app-surface-raised px-4 py-3 text-left transition hover:border-app-line-strong hover:bg-app-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            >
              <span className="flex items-center justify-between gap-3 text-[0.62rem] text-app-faint">
                CHARACTER · {character.id}
                <span aria-hidden="true" className="text-sm group-hover:text-app-accent">
                  →
                </span>
              </span>
              <strong className="mt-3 block font-serif text-lg font-medium tracking-[-0.025em] text-app-ink">
                {name}
              </strong>
              <span className="mt-1 block text-[0.68rem] text-app-faint">
                {character.outfits.length} 套造型
              </span>
            </button>
          )
        })}
      </div>
      <Pagination
        page={characters.page}
        pageSize={characters.pageSize}
        total={characters.total}
        onPageChange={onPageChange}
      />
    </div>
  )
}

function OutfitSelection({
  character,
  onPageChange,
  page,
}: {
  character: Character
  onPageChange: (page: number) => void
  page: number
}) {
  const start = (page - 1) * CONTEXT_PAGE_SIZE
  const outfits = character.outfits.slice(start, start + CONTEXT_PAGE_SIZE)
  const name = character.name ?? '未命名角色'

  return (
    <div>
      <p className="mb-3 text-xs leading-5 text-app-muted">只有包含真实动作帧的造型可以进入。</p>
      <div className="space-y-3">
        {outfits.map((outfit) => {
          const playback = getOutfitPlayback(outfit)
          const card = (
            <div
              className={`rounded-[1.1rem] border px-4 py-3 ${
                playback.playable
                  ? 'border-app-line bg-app-surface-raised transition group-hover:border-app-line-strong group-hover:bg-app-surface-raised'
                  : 'border-app-line bg-app-surface text-app-faint'
              }`}
            >
              <span className="flex items-center justify-between gap-3 text-[0.62rem]">
                <span className="font-mono tracking-[0.08em] text-app-faint uppercase">
                  Outfit · {outfit.id}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold ${
                    playback.playable
                      ? 'border-app-line-strong bg-app-accent-muted text-app-accent'
                      : 'border-app-line bg-app-surface text-app-faint'
                  }`}
                >
                  {playback.playable ? '可预览' : '待补帧'}
                </span>
              </span>
              <span className="mt-2 flex items-end justify-between gap-3">
                <span>
                  <strong className="block font-serif text-lg font-medium tracking-[-0.025em] text-app-ink">
                    {outfit.name}
                  </strong>
                  <span className="mt-1 block text-[0.68rem] text-app-muted">
                    {playback.playable
                      ? `${outfit.actions.length} 个动作 · ${playback.frameCount} 帧`
                      : '尚无可播放帧'}
                  </span>
                </span>
                <span aria-hidden="true" className="text-sm text-app-muted">
                  {playback.playable ? '↗' : '—'}
                </span>
              </span>
            </div>
          )

          return playback.playable ? (
            <Link
              key={outfit.id}
              to={`/playtest/${character.id}/${outfit.id}`}
              aria-label={`预览 ${name} · ${outfit.name}`}
              className="group block rounded-[1.1rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            >
              {card}
            </Link>
          ) : (
            <div key={outfit.id} aria-disabled="true">
              {card}
            </div>
          )
        })}
      </div>
      <Pagination
        page={page}
        pageSize={CONTEXT_PAGE_SIZE}
        total={character.outfits.length}
        onPageChange={onPageChange}
      />
    </div>
  )
}

function SelectedContext({
  actionLabel,
  label,
  onReset,
  value,
}: {
  actionLabel: string
  label: string
  onReset: () => void
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-app-line bg-app-accent-muted px-3.5 py-3">
      <span className="min-w-0">
        <span className="block font-mono text-[0.56rem] font-semibold tracking-[0.12em] text-app-faint uppercase">
          已选{label}
        </span>
        <strong className="mt-0.5 block truncate text-xs font-semibold text-app-ink-soft">
          {value}
        </strong>
      </span>
      <button
        type="button"
        aria-label={actionLabel}
        onClick={onReset}
        className="min-h-9 shrink-0 rounded-full border border-app-line-strong bg-app-surface-raised px-3 text-[0.68rem] font-semibold text-app-ink-soft transition hover:border-app-line-strong hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
      >
        更换
      </button>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="rounded-[1.25rem] border border-app-line bg-app-surface-raised p-5"
    >
      <p className="text-xs font-medium text-app-muted">{label}</p>
      <div aria-hidden="true" className="mt-5 space-y-3">
        <span className="workspace-loading-line block h-3 w-2/3 rounded-full" />
        <span className="workspace-loading-line block h-3 w-full rounded-full" />
        <span className="workspace-loading-line block h-3 w-5/6 rounded-full" />
      </div>
    </div>
  )
}

function ErrorState({
  children,
  description,
  onRetry,
  retryLabel,
  title,
}: {
  children?: ReactNode
  description: string
  onRetry: () => void
  retryLabel: string
  title: string
}) {
  return (
    <div
      role="alert"
      className="rounded-[1.25rem] border border-app-danger-line bg-app-danger-soft p-5"
    >
      <p className="font-serif text-xl font-medium tracking-[-0.025em] text-app-danger">{title}</p>
      <p className="mt-2 text-xs leading-5 text-app-danger-muted">{description}</p>
      <div className="mt-5 flex flex-wrap gap-2.5">
        <button
          type="button"
          aria-label={retryLabel}
          onClick={onRetry}
          className="inline-flex min-h-10 items-center rounded-full bg-app-danger px-4 text-xs font-semibold text-app-on-accent transition hover:bg-app-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger"
        >
          重试
        </button>
        {children}
      </div>
    </div>
  )
}

function EmptyState({
  children,
  description,
  title,
}: {
  children?: ReactNode
  description: string
  title: string
}) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-app-line bg-app-surface p-5 sm:p-6">
      <strong className="font-serif text-xl font-medium tracking-[-0.025em] text-app-ink-soft">
        {title}
      </strong>
      <p className="mt-2 max-w-md text-xs leading-5 text-app-muted">{description}</p>
      {children ? <div className="mt-5 flex flex-wrap gap-2.5">{children}</div> : null}
    </div>
  )
}

function ContextFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2.5 ${className}`}>{children}</div>
}

function ContextLink({ children, ...props }: Omit<React.ComponentProps<typeof Link>, 'className'>) {
  return (
    <Link
      {...props}
      className="inline-flex min-h-10 items-center rounded-full border border-app-line bg-app-surface-raised px-4 text-xs font-semibold text-app-ink-soft transition hover:border-app-line-strong hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      {children}
    </Link>
  )
}

function PrimaryContextLink({
  children,
  ...props
}: Omit<React.ComponentProps<typeof Link>, 'className'>) {
  return (
    <Link
      {...props}
      className="inline-flex min-h-10 items-center rounded-full bg-app-accent px-4 text-xs font-semibold text-app-on-accent transition hover:bg-app-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      {children}
    </Link>
  )
}
