/**
 * 工作流编辑器 — 对齐 PR #74 的 Service 模式。
 * /workflow-editor           → 项目配置表单 + WorkflowRun 初始化
 * /workflow-editor/:runId    → 工作流进度（节点画布）
 *
 * 接口不可用时，每个步骤显示"需要接口"提示，可跳过。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import type { WorkflowRun } from '@/entities'
import { createWorkflowRunStore } from '@/entities/workflow-run/store'
import { NodeCanvasController } from './node-canvas'
import { WorkflowCanvas } from './workflow-canvas'
import { unavailableWorkflowEditorService, type WorkflowEditorService, type ProjectSetupInput } from './service'
import './workflow-editor.css'

export type { CreateWorkflowEditorServiceOptions, PrepareWorkflowProject, WorkflowEditorService } from './service'

export interface WorkflowEditorPageProps {
  service?: WorkflowEditorService
}

export function WorkflowEditorPage({ service = unavailableWorkflowEditorService }: WorkflowEditorPageProps) {
  const { runId } = useParams()
  if (!runId) return <WorkflowSetupView service={service} />
  if (runId === 'local') return <WorkflowLocalView />
  return <WorkflowRunView service={service} runId={runId} />
}

/** /workflow-editor — 选择入口 */
function WorkflowSetupView({ service }: { service: WorkflowEditorService }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'choose' | 'workflow'>('choose')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unavailableReason = service.unavailableReason

  const handleSubmit = useCallback(async (input: ProjectSetupInput) => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (unavailableReason) {
        navigate('/workflow-editor/local')
        return
      }
      const run = await service.createRun(input)
      navigate(`/workflow-editor/${encodeURIComponent(run.id)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }, [service, submitting, unavailableReason, navigate])

  return (
    <div className="workflow-app">
      <StudioBar />
      <div className="production-canvas-workspace">
        {mode === 'choose' && <ModeChooser onSelectWorkflow={() => setMode('workflow')} />}
        {mode === 'workflow' && (
          <>
            <ProjectSetupInner onSubmit={handleSubmit} />
            {unavailableReason && <p className="setup-notice">{unavailableReason}</p>}
            {error && <p role="alert" className="setup-error">{error}</p>}
            {submitting && <p className="setup-loading">正在创建项目…</p>}
          </>
        )}
      </div>
    </div>
  )
}

/** 模式选择器 */
function ModeChooser({ onSelectWorkflow }: { onSelectWorkflow: () => void }) {
  return (
    <section className="studio-mode-gateway">
      <header className="studio-mode-gateway__header">
        <span className="overline">CREATE</span>
        <h1>选择你的创作方式</h1>
        <p>用一句自然语言快速开始，或沿可回退的节点工作流逐步确认。</p>
      </header>
      <div className="studio-mode-gateway__choices">
        <a
          className="studio-mode-card studio-mode-card--natural"
          href="/quick-start"
        >
          <span className="studio-mode-card__eyebrow">ONE COMMAND</span>
          <span className="studio-mode-card__index">01</span>
          <span className="studio-mode-card__copy">
            <small>AI 资产生成</small>
            <b>快速开始</b>
            <p>描述角色、动作和交付目标，自动完成理解、生成、质检与打包。</p>
          </span>
          <span className="studio-mode-card__action">输入创作指令  →</span>
        </a>
        <button
          className="studio-mode-card studio-mode-card--workflow"
          type="button"
          onClick={onSelectWorkflow}
        >
          <span className="studio-mode-card__eyebrow">STEP BY STEP</span>
          <span className="studio-mode-card__index">02</span>
          <span className="studio-mode-card__copy">
            <small>GUIDED WORKFLOW</small>
            <b>节点工作流</b>
            <p>从一个项目开始，逐节点连接、生成与确认角色动作资产。</p>
          </span>
          <span className="studio-mode-card__action">进入工作流  ↗</span>
        </button>
      </div>
      <footer className="studio-mode-gateway__note">
        <i aria-hidden="true" />
        <span>
          <b>两种方式共享同一套生成能力</b>
          <small>快速开始自动推进，节点工作流手动确认每一步。</small>
        </span>
      </footer>
    </section>
  )
}

/** 项目配置表单 */
function ProjectSetupInner({ onSubmit }: { onSubmit: (input: ProjectSetupInput) => void }) {
  const [form, setForm] = useState<ProjectSetupInput>({
    projectName: '',
    view: 'side',
    directions: '1',
    canvasSize: '256',
    style: '',
  })

  return (
    <section className="project-setup">
      <form className="project-setup__form" onSubmit={(e) => { e.preventDefault(); onSubmit(form) }}>
        <header className="project-setup__form-head project-setup__wide">
          <h2>新建角色项目</h2>
        </header>

        <label className="project-setup__wide">
          <span>项目名称</span>
          <input required maxLength={48} value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} placeholder="例如：雾港来信" />
        </label>

        <label>
          <span>游戏视角</span>
          <select value={form.view} onChange={(e) => setForm({ ...form, view: e.target.value })}>
            <option value="side">横版侧视</option>
            <option value="topdown">俯视</option>
            <option value="isometric">2.5D</option>
          </select>
        </label>

        <label>
          <span>方向数量</span>
          <select value={form.directions} onChange={(e) => setForm({ ...form, directions: e.target.value })}>
            <option value="1">单向</option>
            <option value="4">四向</option>
            <option value="8">八向</option>
          </select>
        </label>

        <label>
          <span>角色画布尺寸</span>
          <select value={form.canvasSize} onChange={(e) => setForm({ ...form, canvasSize: e.target.value })}>
            <option value="128">128 × 128</option>
            <option value="256">256 × 256</option>
            <option value="512">512 × 512</option>
          </select>
        </label>

        <label className="project-setup__wide">
          <span>美术风格</span>
          <textarea rows={3} maxLength={240} value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} placeholder="例如：低饱和像素风、细长比例、深灰旅行服" />
        </label>

        <footer className="project-setup__wide">
          <button className="button button--primary" type="submit">进入创作画布 ↗</button>
        </footer>
      </form>
    </section>
  )
}

/** /workflow-editor/local — 接口不可用时的本地模式 */
function WorkflowLocalView() {
  const navigate = useNavigate()
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const controller = useMemo(() => new NodeCanvasController(), [])
  const store = useMemo(() => createWorkflowRunStore(), [])

  // 每次 run 变化时持久化到 store
  useEffect(() => {
    if (run) store.save(run)
  }, [run, store])

  useEffect(() => {
    const now = new Date().toISOString()
    const runId = `local-${Date.now()}`
    const revisionId = `${runId}:rev-1`
    const mockRun: WorkflowRun = {
      id: runId,
      projectId: 'local',
      characterId: null,
      outfitId: null,
      purpose: 'create_character',
      driver: 'manual',
      status: 'active',
      currentRevisionId: revisionId,
      revisions: [{
        id: revisionId,
        basedOnRevisionId: null,
        restartStepId: null,
        status: 'active',
        steps: [
          { id: `${revisionId}:character-setup`, type: 'character-setup', status: 'active', taskId: null, submissionId: null, error: null, referenceStepIds: [], input: null, output: null },
          { id: `${revisionId}:character-template`, type: 'character-template', status: 'locked', taskId: null, submissionId: null, error: null, referenceStepIds: [], input: null, output: null },
          { id: `${revisionId}:template-candidate`, type: 'template-candidate', status: 'locked', taskId: null, submissionId: null, error: null, referenceStepIds: [], input: null, output: null },
          { id: `${revisionId}:action-setup`, type: 'action-setup', status: 'locked', taskId: null, submissionId: null, error: null, referenceStepIds: [], input: null, output: null },
          { id: `${revisionId}:first-frame`, type: 'first-frame', status: 'locked', taskId: null, submissionId: null, error: null, referenceStepIds: [], input: null, output: null },
          { id: `${revisionId}:complete-animation`, type: 'complete-animation', status: 'locked', taskId: null, submissionId: null, error: null, referenceStepIds: [], input: null, output: null },
          { id: `${revisionId}:review`, type: 'review', status: 'locked', taskId: null, submissionId: null, error: null, referenceStepIds: [], input: null, output: null },
          { id: `${revisionId}:export`, type: 'export', status: 'locked', taskId: null, submissionId: null, error: null, referenceStepIds: [], input: null, output: null },
        ],
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        createdAt: now,
      }],
      prompt: null,
    }
    setRun(mockRun)
  }, [])

  const handleStepAction = useCallback((stepType: string, action: string) => {
    if (!run || action !== 'skip') return
    const revision = run.revisions.find((r) => r.id === run.currentRevisionId)
    if (!revision) return

    const currentStepIndex = revision.steps.findIndex((s) => s.status === 'active')
    if (currentStepIndex === -1) return

    const updatedSteps = [...revision.steps]
    updatedSteps[currentStepIndex] = { ...updatedSteps[currentStepIndex], status: 'passed' as const }
    const isLastStep = currentStepIndex + 1 >= updatedSteps.length
    if (!isLastStep) {
      updatedSteps[currentStepIndex + 1] = { ...updatedSteps[currentStepIndex + 1], status: 'active' as const }
    }

    const updatedRun: WorkflowRun = {
      ...run,
      status: isLastStep ? 'completed' : run.status,
      revisions: run.revisions.map((r) =>
        r.id === revision.id
          ? { ...r, steps: updatedSteps, status: isLastStep ? ('completed' as const) : r.status }
          : r
      ),
    }
    setRun(updatedRun)
  }, [run])

  if (!run) {
    return (
      <div className="workflow-app">
        <StudioBar />
        <div className="production-canvas-workspace">
          <p className="setup-loading">正在初始化…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="workflow-app">
      <StudioBar
        runId={run.id}
        status={run.status}
        onReset={() => navigate('/workflow-editor')}
      />
      <div className="production-canvas-workspace">
        <WorkflowCanvas
          controller={controller}
          run={run}
          unavailableReason="接口尚未配置，无法执行此步骤"
          onStepAction={handleStepAction}
        />
      </div>
    </div>
  )
}

/** /workflow-editor/:runId — 工作流进度（节点画布） */
function WorkflowRunView({ service, runId }: { service: WorkflowEditorService; runId: string }) {
  const navigate = useNavigate()
  const [run, setRun] = useState<WorkflowRun | null>(() => service.getWorkflow(runId))
  const controller = useMemo(() => new NodeCanvasController(), [])

  useEffect(() => {
    const current = service.getWorkflow(runId)
    setRun(current)
    if (!current) return

    const unsubscribe = service.subscribe(runId, (updated) => {
      setRun(updated)
    })
    void service.resume(runId).catch(() => {})
    return () => unsubscribe()
  }, [runId, service])

  // 节点聚焦
  useEffect(() => {
    if (!controller.surface || !run) return
    const revision = run.revisions.find((r) => r.id === run.currentRevisionId)
    if (!revision) return

    const activeStep = revision.steps.find((s) => s.status === 'active')
    if (!activeStep) return

    const node = controller.surface.querySelector(`[data-node-id="${activeStep.type}"]`) as HTMLElement | null
    if (!node || !controller.viewport) return

    const x = parseFloat(node.style.left) || Number(node.dataset.x) || 0
    const y = parseFloat(node.style.top) || Number(node.dataset.y) || 0
    controller.scale = 1
    controller.pan.x = Math.round(controller.viewport.clientWidth / 2 - (x + 146))
    controller.pan.y = Math.round(controller.viewport.clientHeight / 2 - (y + 90))
    controller.applyTransform()
    controller.renderWires()
  }, [controller, run])

  const handleStepAction = useCallback(async (stepType: string, action: string, data?: unknown) => {
    try {
      if (stepType === 'character-setup' && action === 'submit') {
        const input = data as { description: string }
        service.updateCharacterSetup(runId, { description: input.description, referenceMedia: [] })
        await service.nextStep(runId)
      }
    } catch (cause) {
      console.error('Step action failed:', cause)
    }
  }, [service, runId])

  if (!run) {
    return (
      <div className="workflow-app">
        <StudioBar />
        <div className="production-canvas-workspace">
          <section className="error-view">
            <p className="overline">WORKFLOW EDITOR / RECOVERY</p>
            <h1>无法恢复这次创作</h1>
            <p role="alert">没有找到运行记录 {runId}</p>
            <button type="button" onClick={() => navigate('/workflow-editor')} className="button button--primary">
              返回项目配置
            </button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="workflow-app">
      <StudioBar
        runId={run.id}
        status={run.status}
        onReset={() => navigate('/workflow-editor')}
      />
      <div className="production-canvas-workspace">
        <WorkflowCanvas
          controller={controller}
          run={run}
          unavailableReason={service.unavailableReason}
          onStepAction={handleStepAction}
        />
      </div>
    </div>
  )
}

/** 共享 Studio Bar */
function StudioBar({ runId, status, onReset }: { runId?: string; status?: string; onReset?: () => void }) {
  return (
    <header className="studio-bar">
      <div className="studio-bar__left">
        <a className="studio-bar__brand" href="/">
          <span className="product-brand__mark" aria-hidden="true" />
          <b>Windup</b>
        </a>
        <span className="studio-bar__project">
          <b>{runId ? `运行 ${runId.slice(0, 8)}` : '节点工作流'}</b>
          <small>{status === 'active' ? '进行中' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '选择素材来源并逐步确认'}</small>
        </span>
      </div>
      <div className="studio-bar__right">
        <nav className="studio-bar__nav" aria-label="创作导航">
          <a href="/">首页</a>
          <a href="/projects">项目资产</a>
          <a href="/workflow-editor" className="is-active" aria-current="page">创作</a>
        </nav>
        <div className="studio-bar__actions">
          {onReset && <button type="button" onClick={onReset}>重置流程</button>}
        </div>
      </div>
    </header>
  )
}
