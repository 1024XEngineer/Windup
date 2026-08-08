/**
 * 节点画布 — 根据 WorkflowRun 状态动态渲染节点和连线。
 * 对齐 PR #74 的 WorkflowNode 类型驱动渲染。
 */
import { useEffect, useRef } from 'react'

import { CHARACTER_ACTION_FRAME_COUNT } from '@/entities'
import type { WorkflowRun, WorkflowNode } from '@/entities'
import { NodeCanvasController } from './node-canvas'

interface WorkflowCanvasProps {
  controller: NodeCanvasController
  run: WorkflowRun
  unavailableReason: string | null
  onStepAction?: (stepType: string, action: string, data?: unknown) => void
}

/** 节点标题 */
const NODE_TITLES: Record<string, { eyebrow: string; title: string }> = {
  'character-setup': { eyebrow: '01 · SETUP', title: '角色设定' },
  'character-template': { eyebrow: '02 · GENERATE', title: '生成角色图' },
  'action-first-frame': { eyebrow: '03 · FIRST FRAME', title: '首帧生成' },
  'action-generation-method': { eyebrow: '04 · METHOD', title: '生成路线' },
  'action-full-frame': { eyebrow: '05 · FULL ANIMATION', title: '完整帧率生成' },
  review: { eyebrow: '06 · REVIEW', title: '审核' },
}

const STEP_STATUS_LABELS: Record<string, string> = {
  locked: '等待上游',
  active: '当前',
  passed: '已完成',
  failed: '失败',
}

/** 角色母版生成的产品约束：每次只让用户比较四张候选。 */
const CHARACTER_CANDIDATE_COUNT = 4

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function buildNodeHtml(
  node: WorkflowNode,
  nodeIndex: number,
  unavailableReason: string | null,
  run: WorkflowRun,
): string {
  const baseMeta = NODE_TITLES[node.type] || {
    eyebrow: node.type.toUpperCase(),
    title: node.type,
  }
  const actionNumber = nodeIndex >= 2 ? Math.floor((nodeIndex - 2) / 4) + 1 : null
  const meta = {
    eyebrow: `${String(nodeIndex + 1).padStart(2, '0')} · ${baseMeta.eyebrow.split(' · ').at(-1)}`,
    title:
      actionNumber && node.type === 'action-full-frame'
        ? `动作生成 ${actionNumber}`
        : actionNumber && node.type === 'review'
          ? `动作 ${actionNumber} 审核`
          : baseMeta.title,
  }
  // 角色节点固定；每个动作四节点分支各占一行，既能并行也不会互相覆盖。
  const actionPhase = nodeIndex >= 2 ? (nodeIndex - 2) % 4 : 0
  const actionRow = nodeIndex >= 2 ? Math.floor((nodeIndex - 2) / 4) : 0
  const pos =
    nodeIndex === 0
      ? { x: 70, y: 280 }
      : nodeIndex === 1
        ? { x: 510, y: 280 }
        : { x: 950 + actionPhase * 430, y: 100 + actionRow * 360 }
  const statusLabel = node.deletedAt ? '已删除' : STEP_STATUS_LABELS[node.status] || node.status
  const isActive = node.status === 'active'
  const isPassed = node.status === 'passed'

  let bodyHtml = ''

  // 接口不可用时如实阻断当前节点，不伪造一条成功记录。
  if (isActive && unavailableReason) {
    bodyHtml = `
      <div class="node-status node-status--active"><span>${meta.title}</span><b>${statusLabel}</b></div>
      <div class="node-api-notice">
        <p>${unavailableReason}</p>
      </div>
    `
  } else {
    // 每个节点的具体 UI
    switch (node.type) {
      case 'character-setup':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>角色设定</span><b>${statusLabel}</b></div>
            <p class="node-desc">填写角色身份、外观和视觉风格，或直接上传已准备好的角色母版。</p>
            <form class="node-brief-form" id="characterSetupForm">
              <div class="node-brief-form__field">
                <label class="node-brief-form__label" for="characterSetupDescription">角色描述</label>
                <textarea class="node-brief-form__textarea" id="characterSetupDescription" name="description" maxlength="500" rows="5" aria-describedby="characterSetupDescriptionHint" placeholder="描述角色身份、外观和视觉风格…"></textarea>
                <small class="node-brief-form__hint" id="characterSetupDescriptionHint">支持多行输入，最多 500 字。</small>
              </div>
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
          bodyHtml = `<div class="node-status node-status--${node.status}"><span>角色设定</span><b>${statusLabel}</b></div>`
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
          bodyHtml = `<div class="node-status node-status--${node.status}"><span>生成角色图</span><b>${statusLabel}</b></div>`
        }
        break

      case 'action-first-frame':
        if (isActive) {
          const templateNode = run.nodes.find((item) => item.type === 'character-template')
          const candidates =
            templateNode?.type === 'character-template'
              ? (templateNode.output?.imageUrls ?? []).slice(0, CHARACTER_CANDIDATE_COUNT)
              : []
          bodyHtml = `
            <div class="node-status node-status--active"><span>确认候选</span><b>${statusLabel}</b></div>
            <div class="node-candidate-intro">
              <strong>${CHARACTER_CANDIDATE_COUNT} 选 1</strong>
              <span>选择一张作为角色母版，确认前可以随时切换。</span>
            </div>
            <div class="node-candidate-list">
              ${candidates.map((candidateUrl, index) => `<button type="button" class="node-candidate" data-select-candidate="${index}" data-candidate-url="${escapeAttribute(candidateUrl)}" aria-pressed="false"><span class="node-candidate__image"><img src="${escapeAttribute(candidateUrl)}" alt="角色图候选 ${index + 1}"><i aria-hidden="true">✓</i></span><small>候选 ${String(index + 1).padStart(2, '0')}</small></button>`).join('')}
            </div>
            ${candidates.length > 0 ? '<button type="button" class="node-action" data-confirm-candidate="" disabled>请先选择一张候选</button>' : '<p class="node-desc">生成结果中没有可用候选。</p>'}
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>确认候选</span><b>${statusLabel}</b></div>
            <p class="node-desc">已确认身份母版。</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${node.status}"><span>确认候选</span><b>${statusLabel}</b></div>`
        }
        break

      case 'action-full-frame':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>动作生成</span><b>生成中…</b></div>
            <div class="node-generating"><i class="pulse"></i><small>正在生成 ${CHARACTER_ACTION_FRAME_COUNT} 帧动作动画…</small></div>
            <div class="node-frame-strip">
              ${Array.from({ length: CHARACTER_ACTION_FRAME_COUNT }, (_, i) => `<span class="is-pending"><small>${String(i + 1).padStart(2, '0')}</small></span>`).join('')}
            </div>
          `
        } else if (isPassed) {
          const frames = node.type === 'action-full-frame' ? (node.output?.frames ?? []) : []
          bodyHtml = `
            <div class="node-status node-status--passed"><span>动作生成</span><b>${statusLabel}</b></div>
            <div class="node-frame-strip">
              ${frames.map((frame, i) => `<span class="is-arrived"><img src="${escapeAttribute(frame.imageUrl)}" alt="动作第 ${i + 1} 帧"><small>${String(i + 1).padStart(2, '0')}</small></span>`).join('')}
            </div>
            <p class="node-desc">动作帧已生成，进入审核。</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${node.status}"><span>动作生成</span><b>${statusLabel}</b></div>`
        }
        break

      case 'action-generation-method':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>生成路线</span><b>${statusLabel}</b></div>
            <p class="node-desc">选择如何把已确认首帧转换为完整动作资产。</p>
            <div class="node-method-options">
              <button type="button" class="node-action" data-generation-method="video-cropping">使用视频裁剪生成</button>
              <button type="button" class="node-action" data-generation-method="3d-to-2d" disabled title="等待后端接口">使用 3D 转 2D 生成</button>
            </div>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>生成路线</span><b>${statusLabel}</b></div>
            <p class="node-desc">${node.input?.method === '3d-to-2d' ? '3D 转 2D' : '视频裁剪'}</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${node.status}"><span>生成路线</span><b>${statusLabel}</b></div>`
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
          bodyHtml = `<div class="node-status node-status--${node.status}"><span>审核</span><b>${statusLabel}</b></div>`
        }
        break
      }

      default:
        bodyHtml = `<div class="node-status"><span>${meta.title}</span><b>${statusLabel}</b></div>`
    }
  }

  const hasInput = node.type !== 'character-setup'
  const hasOutput = node.type !== 'review'
  const outputEnabled = isPassed || isActive

  return `
    <article class="graph-node graph-node--${node.status}${hasInput ? ' has-input' : ''}" data-node-id="${escapeAttribute(node.id)}" data-x="${pos.x}" data-y="${pos.y}" style="left:${pos.x}px;top:${pos.y}px">
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

  // 连线直接读取持久化边，不能按 DOM 相邻顺序猜测并行 Action 的关系。
  useEffect(() => {
    controller.setConnections(
      run.nodes.flatMap((node) => node.dependsOnNodeIds.map((from) => ({ from, to: node.id }))),
    )
  }, [controller, run])

  // 绑定交互事件
  useEffect(() => {
    if (!rootRef.current) return
    controller.attach(rootRef.current)
    const root = rootRef.current
    const form = root.querySelector<HTMLFormElement>('#characterSetupForm')
    const nodeIdFor = (target: EventTarget | null) =>
      (target as HTMLElement | null)?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? ''
    const handleSetupSubmit = (event: Event) => {
      event.preventDefault()
      const description = new FormData(form!).get('description')
      const fileInput = form?.elements.namedItem('templateFile') as HTMLInputElement | null
      const file = fileInput?.files?.[0]
      if (typeof description === 'string' && (description.trim() || file)) {
        onStepAction?.('character-setup', 'submit', {
          nodeId: nodeIdFor(form),
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
    const handleCandidateConfirm = (event: Event) => {
      const selectedImageUrl = confirmCandidate?.dataset.candidateUrl
      if (selectedImageUrl) {
        onStepAction?.('action-first-frame', 'confirm', {
          nodeId: nodeIdFor(event.currentTarget),
          selectedImageUrl,
        })
      }
    }
    confirmCandidate?.addEventListener('click', handleCandidateConfirm)

    const methodButtons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[data-generation-method]'),
    )
    const handleMethodSelect = (event: Event) => {
      const method = (event.currentTarget as HTMLButtonElement).dataset.generationMethod
      if (method === 'video-cropping' || method === '3d-to-2d') {
        onStepAction?.('action-generation-method', 'select', {
          nodeId: nodeIdFor(event.currentTarget),
          method,
        })
      }
    }
    methodButtons.forEach((button) => button.addEventListener('click', handleMethodSelect))

    const approveReview = root.querySelector<HTMLButtonElement>('[data-approve-review]')
    const handleReviewApprove = (event: Event) =>
      onStepAction?.('review', 'approve', { nodeId: nodeIdFor(event.currentTarget) })
    approveReview?.addEventListener('click', handleReviewApprove)

    return () => {
      form?.removeEventListener('submit', handleSetupSubmit)
      candidateButtons.forEach((button) => button.removeEventListener('click', selectCandidate))
      confirmCandidate?.removeEventListener('click', handleCandidateConfirm)
      methodButtons.forEach((button) => button.removeEventListener('click', handleMethodSelect))
      approveReview?.removeEventListener('click', handleReviewApprove)
      controller.detach()
    }
  }, [controller, run, onStepAction])

  const visibleSteps = run.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node, index }) => {
      if (node.status !== 'locked') return true
      return index <= 1 // 只显示前两步（character-setup 和 character-template）
    })

  return (
    <section ref={rootRef} className="node-graph-workspace">
      <div className="node-canvas" data-node-canvas="">
        <div
          className="node-surface"
          data-node-surface=""
          dangerouslySetInnerHTML={{
            __html: `<svg class="node-wires" data-node-wires="" aria-hidden="true"></svg>${visibleSteps.map(({ node, index }) => buildNodeHtml(node, index, unavailableReason, run)).join('')}`,
          }}
        />
        <div className="node-canvas-hint">
          <span className="node-canvas-hint__copy">
            <b>{getHintText(run)}</b>
            <span>逐节点推进，完成所有节点后导出资产</span>
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

function getHintText(workflow: WorkflowRun): string {
  const activeNode = workflow.nodes.find((node) => node.status === 'active' && !node.deletedAt)
  if (!activeNode) return '所有节点已完成'
  const meta = NODE_TITLES[activeNode.type]
  return meta ? `当前：${meta.title}` : `当前：${activeNode.type}`
}
