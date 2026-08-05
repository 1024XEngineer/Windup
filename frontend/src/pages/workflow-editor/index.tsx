/**
 * 工作流编辑器 — 对齐 PR #74 的 Service 模式。
 * /workflow-editor           → 项目配置表单 + WorkflowRun 初始化
 * /workflow-editor/:runId    → 工作流进度（节点画布）
 *
 * 运行数据只来自 WorkflowEditorService，不在页面里伪造第二套流程状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import type { WorkflowRun } from '@/entities'
import { buildPlaytestPath, buildPublishedActionId, canPublishToPlaytest } from '@/features/publish'
import { NodeCanvasController } from './node-canvas'
import { WorkflowCanvas } from './workflow-canvas'
import {
  unavailableWorkflowEditorService,
  type WorkflowEditorService,
  type ProjectSetupInput,
} from './service'
import './workflow-editor.css'

export type {
  CreateWorkflowEditorServiceOptions,
  PrepareWorkflowProject,
  WorkflowEditorService,
} from './service'

export interface WorkflowEditorPageProps {
  service?: WorkflowEditorService
}

export function WorkflowEditorPage({
  service = unavailableWorkflowEditorService,
}: WorkflowEditorPageProps) {
  const { runId, stepId } = useParams()
  if (!runId) return <WorkflowSetupView service={service} />
  return <WorkflowRunView service={service} runId={runId} stepId={stepId} />
}

/** /workflow-editor — 直接进入项目配置表单 */
function WorkflowSetupView({ service }: { service: WorkflowEditorService }) {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unavailableReason = service.unavailableReason

  const handleSubmit = useCallback(
    async (input: ProjectSetupInput) => {
      if (submitting) return
      setSubmitting(true)
      setError(null)
      try {
        if (unavailableReason) {
          throw new Error(unavailableReason)
        }
        const run = await service.createRun(input)
        navigate(`/workflow-editor/${encodeURIComponent(run.id)}`)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '创建失败，请稍后重试')
      } finally {
        setSubmitting(false)
      }
    },
    [service, submitting, unavailableReason, navigate],
  )

  return (
    <div className="workflow-app">
      <StudioBar />
      <div className="production-canvas-workspace">
        <ProjectSetupInner onSubmit={handleSubmit} />
        {unavailableReason && <p className="setup-notice">{unavailableReason}</p>}
        {error && (
          <p role="alert" className="setup-error">
            {error}
          </p>
        )}
        {submitting && <p className="setup-loading">正在创建项目…</p>}
      </div>
    </div>
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
      <form
        className="project-setup__form"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(form)
        }}
      >
        <header className="project-setup__form-head project-setup__wide">
          <h2>新建角色项目</h2>
        </header>

        <label className="project-setup__wide">
          <span>项目名称</span>
          <input
            required
            maxLength={48}
            value={form.projectName}
            onChange={(e) => setForm({ ...form, projectName: e.target.value })}
            placeholder="例如：雾港来信"
          />
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
          <select
            value={form.directions}
            onChange={(e) => setForm({ ...form, directions: e.target.value })}
          >
            <option value="1">单向</option>
            <option value="4">四向</option>
            <option value="8">八向</option>
          </select>
        </label>

        <label>
          <span>角色画布尺寸</span>
          <select
            value={form.canvasSize}
            onChange={(e) => setForm({ ...form, canvasSize: e.target.value })}
          >
            <option value="128">128 × 128</option>
            <option value="256">256 × 256</option>
            <option value="512">512 × 512</option>
          </select>
        </label>

        <label className="project-setup__wide">
          <span>美术风格</span>
          <textarea
            rows={3}
            maxLength={240}
            value={form.style}
            onChange={(e) => setForm({ ...form, style: e.target.value })}
            placeholder="例如：低饱和像素风、细长比例、深灰旅行服"
          />
        </label>

        <footer className="project-setup__wide">
          <button className="button button--primary" type="submit">
            进入创作画布 ↗
          </button>
        </footer>
      </form>
    </section>
  )
}

/** /workflow-editor/:runId — 工作流进度（节点画布） */
function WorkflowRunView({
  service,
  runId,
  stepId,
}: {
  service: WorkflowEditorService
  runId: string
  stepId?: string
}) {
  const navigate = useNavigate()
  const [run, setRun] = useState<WorkflowRun | null>(() => service.getWorkflow(runId))
  const [actionError, setActionError] = useState<string | null>(null)
  const [completionMessage, setCompletionMessage] = useState<string | null>(null)
  const controller = useMemo(() => new NodeCanvasController(), [])
  const uploadedTemplateAbortRef = useRef<AbortController | null>(null)

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

  useEffect(() => {
    return () => {
      uploadedTemplateAbortRef.current?.abort()
      uploadedTemplateAbortRef.current = null
    }
  }, [runId])

  // 节点聚焦
  useEffect(() => {
    if (!controller.surface || !run) return
    const revision = run.revisions.find((r) => r.id === run.currentRevisionId)
    if (!revision) return

    const focusedStep =
      revision.steps.find((step) => step.id === stepId || step.type === stepId) ??
      revision.steps.find((step) => step.status === 'active')
    if (!focusedStep) return

    const node = controller.surface.querySelector(
      `[data-node-id="${focusedStep.type}"]`,
    ) as HTMLElement | null
    if (!node || !controller.viewport) return

    const x = parseFloat(node.style.left) || Number(node.dataset.x) || 0
    const y = parseFloat(node.style.top) || Number(node.dataset.y) || 0
    const nodeWidth = node.offsetWidth || 324
    const nodeHeight = node.offsetHeight || 180
    const centeredTop = Math.max(72, (controller.viewport.clientHeight - nodeHeight) / 2)
    controller.scale = 1
    controller.pan.x = Math.round(controller.viewport.clientWidth / 2 - (x + nodeWidth / 2))
    controller.pan.y = Math.round(centeredTop - y)
    controller.applyTransform()
    controller.renderWires()
  }, [controller, run, stepId])

  const handleStepAction = useCallback(
    async (stepType: string, action: string, data?: unknown) => {
      try {
        setActionError(null)
        if (stepType === 'character-setup' && action === 'submit') {
          const input = data as { description: string; file?: File }
          if (input.file) {
            uploadedTemplateAbortRef.current?.abort()
            const abortController = new AbortController()
            uploadedTemplateAbortRef.current = abortController
            try {
              const uploaded = await service.continueWithUploadedTemplate(
                runId,
                input.file,
                input.description,
                abortController.signal,
              )
              setRun(uploaded)
            } catch (cause) {
              const isAborted =
                abortController.signal.aborted ||
                (cause instanceof Error && cause.name === 'AbortError')
              if (!isAborted && uploadedTemplateAbortRef.current === abortController) {
                console.error('Step action failed:', cause)
                setActionError(cause instanceof Error ? cause.message : '操作失败，请稍后重试')
              }
            } finally {
              if (uploadedTemplateAbortRef.current === abortController) {
                uploadedTemplateAbortRef.current = null
              }
            }
            return
          }
          service.updateCharacterSetup(runId, {
            description: input.description,
            referenceMedia: [],
          })
          await service.nextStep(runId)
        }
        if (stepType === 'template-candidate' && action === 'confirm') {
          const input = data as { selectedImageUrl: string }
          await service.confirmCandidate(runId, input.selectedImageUrl)
        }
        if (stepType === 'review' && action === 'approve') {
          const approved = await service.approveReview(runId)
          setRun(approved)
          setCompletionMessage('审核已通过，结果已保留。请选择是否导入 Playtest。')
        }
      } catch (cause) {
        console.error('Step action failed:', cause)
        setActionError(cause instanceof Error ? cause.message : '操作失败，请稍后重试')
      }
    },
    [service, runId],
  )

  if (!run) {
    return (
      <div className="workflow-app">
        <StudioBar />
        <div className="production-canvas-workspace">
          <section className="error-view">
            <p className="overline">WORKFLOW EDITOR / RECOVERY</p>
            <h1>无法恢复这次创作</h1>
            <p role="alert">没有找到运行记录 {runId}</p>
            <button
              type="button"
              onClick={() => navigate('/workflow-editor')}
              className="button button--primary"
            >
              返回项目配置
            </button>
          </section>
        </div>
      </div>
    )
  }

  const playtestPath = buildCompletedPlaytestPath(run)
  const showCompletionActions = canPublishToPlaytest(run) && playtestPath !== null

  return (
    <div className="workflow-app">
      <StudioBar runId={run.id} status={run.status} onReset={() => navigate('/workflow-editor')} />
      <div className="production-canvas-workspace">
        <WorkflowCanvas
          controller={controller}
          run={run}
          unavailableReason={service.unavailableReason}
          onStepAction={handleStepAction}
        />
        {showCompletionActions ? (
          <WorkflowCompletionActions
            message={completionMessage}
            onOpenPlaytest={() => navigate(playtestPath)}
            onStay={() => setCompletionMessage('结果已保留，你可以稍后再导入 Playtest。')}
          />
        ) : null}
        {actionError ? (
          <p className="workflow-action-error" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function buildCompletedPlaytestPath(run: WorkflowRun): string | null {
  if (!run.characterId || !run.outfitId) return null
  const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
  const actionStep = revision?.steps.find((item) => item.type === 'action-generation')
  const actionId =
    actionStep?.type === 'action-generation' && actionStep.output
      ? buildPublishedActionId(run.characterId, run.id)
      : undefined
  return buildPlaytestPath({
    characterId: run.characterId,
    outfitId: run.outfitId,
    actionId,
  })
}

function WorkflowCompletionActions({
  message,
  onOpenPlaytest,
  onStay,
}: {
  message: string | null
  onOpenPlaytest(): void
  onStay(): void
}) {
  return (
    <aside className="workflow-completion" aria-label="工作流完成选项">
      <header>
        <span aria-hidden="true">✓</span>
        <div>
          <small>WORKFLOW COMPLETE</small>
          <h2>创作结果已准备好</h2>
        </div>
      </header>
      <p>结果不会自动跳转。你可以现在导入 Playtest 检查动画，也可以先留在工作流。</p>
      <div className="workflow-completion__actions">
        <button type="button" className="workflow-completion__primary" onClick={onOpenPlaytest}>
          导入 Playtest
        </button>
        <button type="button" className="workflow-completion__secondary" onClick={onStay}>
          留在工作流
        </button>
      </div>
      <p className="workflow-completion__export-note">
        需要下载 PNG、Sprite Sheet 或动画 JSON 时，请在 Playtest 完成质量检查后打开“资产导出”。
      </p>
      {message ? (
        <p className="workflow-completion__message" role="status">
          {message}
        </p>
      ) : null}
    </aside>
  )
}

/** 共享 Studio Bar */
function StudioBar({
  runId,
  status,
  onReset,
}: {
  runId?: string
  status?: string
  onReset?: () => void
}) {
  return (
    <header className="studio-bar">
      <div className="studio-bar__left">
        <a className="studio-bar__brand" href="/">
          <span className="product-brand__mark" aria-hidden="true" />
          <b>Windup</b>
        </a>
        <span className="studio-bar__project">
          <b>{runId ? `运行 ${runId.slice(0, 8)}` : '节点工作流'}</b>
          <small>
            {status === 'active'
              ? '进行中'
              : status === 'completed'
                ? '已完成'
                : status === 'failed'
                  ? '失败'
                  : '选择素材来源并逐步确认'}
          </small>
        </span>
      </div>
      <div className="studio-bar__right">
        <nav className="studio-bar__nav" aria-label="创作导航">
          <a href="/">首页</a>
          <a href="/projects">项目资产</a>
          <a href="/workflow-editor" className="is-active" aria-current="page">
            创作
          </a>
        </nav>
        <div className="studio-bar__actions">
          {onReset && (
            <button type="button" onClick={onReset}>
              重置流程
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
