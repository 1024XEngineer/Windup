/**
 * 节点画布 — 根据 WorkflowRun 状态动态渲染节点和连线。
 * 对齐 PR #74 的 WorkflowStep 类型驱动渲染。
 */
import { useEffect, useRef } from 'react'

import { COMPLETE_ANIMATION_FRAME_COUNT } from '@/entities'
import type { WorkflowRun, WorkflowRevision, WorkflowStep } from '@/entities'
import { NodeCanvasController } from './node-canvas'

interface WorkflowCanvasProps {
  controller: NodeCanvasController
  run: WorkflowRun
  unavailableReason: string | null
  onStepAction?: (stepType: string, action: string, data?: unknown) => void
}

/** 节点布局位置（5 步流程） */
const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  'character-setup': { x: 70, y: 280 },
  'character-template': { x: 510, y: 180 },
  'template-candidate': { x: 950, y: 240 },
  'action-generation': { x: 1390, y: 180 },
  review: { x: 1820, y: 240 },
}

/** 节点标题 */
const NODE_TITLES: Record<string, { eyebrow: string; title: string }> = {
  'character-setup': { eyebrow: '01 · SETUP', title: '角色设定' },
  'character-template': { eyebrow: '02 · GENERATE', title: '生成角色图' },
  'template-candidate': { eyebrow: '03 · CONFIRM', title: '确认候选' },
  'action-generation': { eyebrow: '04 · ANIMATE', title: '动作生成' },
  review: { eyebrow: '05 · REVIEW', title: '审核' },
}

const STEP_STATUS_LABELS: Record<string, string> = {
  locked: '等待上游',
  active: '当前',
  passed: '已完成',
  failed: '失败',
}

/** 角色母版生成的产品约束：每次只让用户比较四张候选。 */
const CHARACTER_CANDIDATE_COUNT = 4

function getCurrentRevision(run: WorkflowRun): WorkflowRevision | null {
  return run.revisions.find((r) => r.id === run.currentRevisionId) ?? null
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function buildNodeHtml(
  step: WorkflowStep,
  unavailableReason: string | null,
  run: WorkflowRun,
): string {
  const meta = NODE_TITLES[step.type] || { eyebrow: step.type.toUpperCase(), title: step.type }
  const pos = NODE_POSITIONS[step.type] || { x: 0, y: 0 }
  const statusLabel = STEP_STATUS_LABELS[step.status] || step.status
  const isActive = step.status === 'active'
  const isPassed = step.status === 'passed'

  let bodyHtml = ''

  // 接口不可用时如实阻断当前步骤，不伪造一条成功记录。
  if (isActive && unavailableReason) {
    bodyHtml = `
      <div class="node-status node-status--active"><span>${meta.title}</span><b>${statusLabel}</b></div>
      <div class="node-api-notice">
        <p>${unavailableReason}</p>
      </div>
    `
  } else {
    // 每个步骤的具体 UI
    switch (step.type) {
      case 'character-setup':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>角色设定</span><b>${statusLabel}</b></div>
            <p class="node-desc">填写角色身份、外观和视觉风格，或直接上传已准备好的角色母版。</p>
            <form class="node-brief-form" id="characterSetupForm">
              <label><span>角色描述</span><textarea name="description" maxlength="500" rows="3" placeholder="描述角色身份、外观和视觉风格…"></textarea></label>
              <label class="node-template-upload"><span>角色母版图片</span><input name="templateFile" type="file" accept="image/*" /><small>选择图片后，角色描述可作为可选动作说明，并会跳过角色图生成。</small></label>
              <button class="node-action" type="submit">提交设定</button>
            </form>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>角色设定</span><b>${statusLabel}</b></div>
            <p class="node-desc">已提交角色设定</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>角色设定</span><b>${statusLabel}</b></div>`
        }
        break

      case 'character-template':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>生成角色图</span><b>生成中…</b></div>
            <div class="node-generation__dots" aria-label="母版候选实时到达">${Array.from(
              { length: 81 },
              (_, i) => {
                const x = (i % 9) - 4,
                  y = Math.floor(i / 9) - 4
                const ring = Math.max(Math.abs(x), Math.abs(y))
                return `<i class="dot-ring-${ring}"></i>`
              },
            ).join('')}</div>
            <small class="node-hint">正在生成 ${CHARACTER_CANDIDATE_COUNT} 张候选母版…</small>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>生成角色图</span><b>${statusLabel}</b></div>
            <p class="node-desc">角色图已生成，下一步确认候选。</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>生成角色图</span><b>${statusLabel}</b></div>`
        }
        break

      case 'template-candidate':
        if (isActive) {
          const templateStep = getCurrentRevision(run)?.steps.find(
            (item) => item.type === 'character-template',
          )
          const candidates =
            templateStep?.type === 'character-template'
              ? (templateStep.output?.images ?? []).slice(0, CHARACTER_CANDIDATE_COUNT)
              : []
          bodyHtml = `
            <div class="node-status node-status--active"><span>确认候选</span><b>${statusLabel}</b></div>
            <div class="node-candidate-intro">
              <strong>${CHARACTER_CANDIDATE_COUNT} 选 1</strong>
              <span>选择一张作为角色母版，确认前可以随时切换。</span>
            </div>
            <div class="node-candidate-list">
              ${candidates.map((candidate, index) => `<button type="button" class="node-candidate" data-select-candidate="${index}" data-candidate-url="${escapeAttribute(candidate.url)}" aria-pressed="false"><span class="node-candidate__image"><img src="${escapeAttribute(candidate.url)}" alt="角色图候选 ${index + 1}"><i aria-hidden="true">✓</i></span><small>候选 ${String(index + 1).padStart(2, '0')}</small></button>`).join('')}
            </div>
            ${candidates.length > 0 ? '<button type="button" class="node-action" data-confirm-candidate="" disabled>请先选择一张候选</button>' : '<p class="node-desc">生成结果中没有可用候选。</p>'}
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>确认候选</span><b>${statusLabel}</b></div>
            <p class="node-desc">已确认身份母版。</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>确认候选</span><b>${statusLabel}</b></div>`
        }
        break

      case 'action-generation':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>动作生成</span><b>生成中…</b></div>
            <div class="node-generating"><i class="pulse"></i><small>正在生成 ${COMPLETE_ANIMATION_FRAME_COUNT} 帧动作动画…</small></div>
            <div class="node-frame-strip">
              ${Array.from({ length: COMPLETE_ANIMATION_FRAME_COUNT }, (_, i) => `<span class="is-pending"><small>${String(i + 1).padStart(2, '0')}</small></span>`).join('')}
            </div>
          `
        } else if (isPassed) {
          const frames = step.type === 'action-generation' ? (step.output?.frames ?? []) : []
          bodyHtml = `
            <div class="node-status node-status--passed"><span>动作生成</span><b>${statusLabel}</b></div>
            <div class="node-frame-strip">
              ${frames.map((frame, i) => `<span class="is-arrived"><img src="${escapeAttribute(frame.url)}" alt="动作第 ${i + 1} 帧"><small>${String(i + 1).padStart(2, '0')}</small></span>`).join('')}
            </div>
            <p class="node-desc">动作帧已生成，进入审核。</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>动作生成</span><b>${statusLabel}</b></div>`
        }
        break

      case 'review': {
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>审核</span><b>${statusLabel}</b></div>
            <p class="node-desc">检查所有动作是否符合预期。</p>
            <button type="button" class="node-action" data-approve-review="">审核通过</button>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>审核</span><b>已完成</b></div>
            <p class="node-desc">生成结果已经保存，下一步由你决定。</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>审核</span><b>${statusLabel}</b></div>`
        }
        break
      }

      default:
        bodyHtml = `<div class="node-status"><span>${meta.title}</span><b>${statusLabel}</b></div>`
    }
  }

  const hasInput = step.type !== 'character-setup'
  const hasOutput = step.type !== 'review'
  const outputEnabled = isPassed || isActive

  return `
    <article class="graph-node graph-node--${step.status}${hasInput ? ' has-input' : ''}" data-node-id="${step.type}" data-x="${pos.x}" data-y="${pos.y}" style="left:${pos.x}px;top:${pos.y}px">
      ${hasInput ? '<button class="graph-port graph-port--input" type="button" aria-label="输入端口" data-port="input" data-enabled="true"></button>' : ''}
      <header data-node-drag="">
        <span><small>${meta.eyebrow}</small><h2>${meta.title}</h2></span>
        <i aria-hidden="true"><b></b><b></b><b></b></i>
      </header>
      <div class="graph-node__body">${bodyHtml}</div>
      ${hasInput ? `<button class="graph-node__connect-surface" type="button" aria-label="确认连接到${meta.title}" data-node-connect-surface=""><span>点击卡片确认连接</span></button>` : ''}
      ${hasOutput ? `<button class="graph-port graph-port--output" type="button" aria-label="输出端口" data-port="output" data-enabled="${outputEnabled}"></button>` : ''}
    </article>
  `
}

export function WorkflowCanvas({
  controller,
  run,
  unavailableReason,
  onStepAction,
}: WorkflowCanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const revision = getCurrentRevision(run)

  // 连线只表达 WorkflowStep 的先后关系，不再作为第二套业务状态门控按钮。
  useEffect(() => {
    if (!revision) return
    controller.renderWires()
  }, [controller, revision])

  // 绑定交互事件
  useEffect(() => {
    if (!rootRef.current || !revision) return
    controller.attach(rootRef.current)
    const root = rootRef.current
    const form = root.querySelector<HTMLFormElement>('#characterSetupForm')
    const handleSetupSubmit = (event: Event) => {
      event.preventDefault()
      const description = new FormData(form!).get('description')
      const fileInput = form?.elements.namedItem('templateFile') as HTMLInputElement | null
      const file = fileInput?.files?.[0]
      if (typeof description === 'string' && (description.trim() || file)) {
        onStepAction?.('character-setup', 'submit', {
          description: description.trim(),
          ...(file ? { file } : {}),
        })
      }
    }
    form?.addEventListener('submit', handleSetupSubmit)

    const candidateButtons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-select-candidate]'),
    )
    const confirmCandidate = root.querySelector<HTMLButtonElement>('[data-confirm-candidate]')
    const selectCandidate = (event: Event) => {
      candidateButtons.forEach((button) => {
        button.classList.remove('is-selected')
        button.setAttribute('aria-pressed', 'false')
      })
      const selected = event.currentTarget as HTMLButtonElement
      selected.classList.add('is-selected')
      selected.setAttribute('aria-pressed', 'true')
      if (confirmCandidate) {
        confirmCandidate.dataset.candidateUrl = selected.dataset.candidateUrl
        const selectedIndex = Number(selected.dataset.selectCandidate) + 1
        confirmCandidate.textContent = `使用候选 ${String(selectedIndex).padStart(2, '0')}`
        confirmCandidate.disabled = false
      }
    }
    candidateButtons.forEach((button) => button.addEventListener('click', selectCandidate))
    const handleCandidateConfirm = () => {
      const selectedImageUrl = confirmCandidate?.dataset.candidateUrl
      if (selectedImageUrl) onStepAction?.('template-candidate', 'confirm', { selectedImageUrl })
    }
    confirmCandidate?.addEventListener('click', handleCandidateConfirm)

    const approveReview = root.querySelector<HTMLButtonElement>('[data-approve-review]')
    const handleReviewApprove = () => onStepAction?.('review', 'approve')
    approveReview?.addEventListener('click', handleReviewApprove)

    return () => {
      form?.removeEventListener('submit', handleSetupSubmit)
      candidateButtons.forEach((button) => button.removeEventListener('click', selectCandidate))
      confirmCandidate?.removeEventListener('click', handleCandidateConfirm)
      approveReview?.removeEventListener('click', handleReviewApprove)
      controller.detach()
    }
  }, [controller, revision, onStepAction])

  if (!revision) {
    return (
      <section className="node-graph-workspace">
        <div className="node-canvas" data-node-canvas="">
          <div className="node-canvas-hint">
            <span className="node-canvas-hint__copy">
              <b>无法加载工作流</b>
              <span>找不到当前版本</span>
            </span>
          </div>
        </div>
      </section>
    )
  }

  const visibleSteps = revision.steps.filter((step, index) => {
    if (step.status !== 'locked') return true
    return index <= 1 // 只显示前两步（character-setup 和 character-template）
  })

  return (
    <section ref={rootRef} className="node-graph-workspace">
      <div className="node-canvas" data-node-canvas="">
        <div
          className="node-surface"
          data-node-surface=""
          dangerouslySetInnerHTML={{
            __html: `<svg class="node-wires" data-node-wires="" aria-hidden="true"></svg>${visibleSteps.map((step) => buildNodeHtml(step, unavailableReason, run)).join('')}`,
          }}
        />
        <div className="node-canvas-hint">
          <span className="node-canvas-hint__copy">
            <b>{getHintText(revision)}</b>
            <span>逐节点推进，完成所有步骤后导出资产</span>
          </span>
        </div>
        <div className="node-zoom" aria-label="画布缩放">
          <button type="button" aria-label="缩小画布" data-node-zoom-out="">
            −
          </button>
          <output data-node-zoom-label="">100%</output>
          <button type="button" aria-label="放大画布" data-node-zoom-in="">
            +
          </button>
          <button type="button" aria-label="整理节点" data-node-arrange="">
            ↺
          </button>
        </div>
      </div>
    </section>
  )
}

function getHintText(revision: WorkflowRevision): string {
  const activeStep = revision.steps.find((s) => s.status === 'active')
  if (!activeStep) return '所有步骤已完成'
  const meta = NODE_TITLES[activeStep.type]
  return meta ? `当前：${meta.title}` : `当前：${activeStep.type}`
}
