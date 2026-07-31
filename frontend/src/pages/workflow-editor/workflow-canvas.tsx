/**
 * 节点画布 — 根据 WorkflowRun 状态动态渲染节点和连线。
 * 对齐 PR #74 的 WorkflowStep 类型驱动渲染。
 */
import { useEffect, useRef } from 'react'

import type { WorkflowRun, WorkflowRevision, WorkflowStep } from '@/entities'
import { NodeCanvasController } from './node-canvas'
import { workflowRunToCharacter, canExportToPlaytest, buildPlaytestUrl } from './workflow-to-character'

interface WorkflowCanvasProps {
  controller: NodeCanvasController
  run: WorkflowRun
  unavailableReason: string | null
  onStepAction?: (stepType: string, action: string, data?: unknown) => void
}

/** 节点布局位置 */
const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  'character-setup': { x: 70, y: 280 },
  'character-template': { x: 510, y: 180 },
  'template-candidate': { x: 950, y: 240 },
  'action-setup': { x: 1390, y: 180 },
  'first-frame': { x: 1820, y: 60 },
  'complete-animation': { x: 1820, y: 300 },
  review: { x: 2250, y: 180 },
  export: { x: 2680, y: 180 },
}

/** 节点标题 */
const NODE_TITLES: Record<string, { eyebrow: string; title: string }> = {
  'character-setup': { eyebrow: '01 · SETUP', title: '角色设定' },
  'character-template': { eyebrow: '02 · GENERATE', title: '生成角色图' },
  'template-candidate': { eyebrow: '03 · CONFIRM', title: '确认候选' },
  'action-setup': { eyebrow: '04 · ACTIONS', title: '动作设定' },
  'first-frame': { eyebrow: '05 · KEYFRAME', title: '生成首帧' },
  'complete-animation': { eyebrow: '06 · ANIMATE', title: '生成动画' },
  review: { eyebrow: '07 · REVIEW', title: '审核' },
  export: { eyebrow: '08 · EXPORT', title: '导出' },
}

const STEP_STATUS_LABELS: Record<string, string> = {
  locked: '等待上游',
  active: '当前',
  passed: '已完成',
  failed: '失败',
}

function getCurrentRevision(run: WorkflowRun): WorkflowRevision | null {
  return run.revisions.find((r) => r.id === run.currentRevisionId) ?? null
}

function buildNodeHtml(step: WorkflowStep, unavailableReason: string | null, run: WorkflowRun): string {
  const meta = NODE_TITLES[step.type] || { eyebrow: step.type.toUpperCase(), title: step.type }
  const pos = NODE_POSITIONS[step.type] || { x: 0, y: 0 }
  const statusLabel = STEP_STATUS_LABELS[step.status] || step.status
  const isActive = step.status === 'active'
  const isPassed = step.status === 'passed'
  const isLocked = step.status === 'locked'

  let bodyHtml = ''

  // 接口不可用 + 当前步骤 → 显示提示 + 跳过
  if (isActive && unavailableReason) {
    bodyHtml = `
      <div class="node-status node-status--active"><span>${meta.title}</span><b>${statusLabel}</b></div>
      <div class="node-api-notice">
        <p>${unavailableReason}</p>
        <button type="button" class="node-action node-action--secondary" data-skip-step="">跳过此步</button>
      </div>
    `
  } else {
    // 每个步骤的具体 UI
    switch (step.type) {
      case 'character-setup':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>角色设定</span><b>${statusLabel}</b></div>
            <p class="node-desc">填写角色身份、外观和视觉风格。</p>
            <form class="node-brief-form" id="characterSetupForm">
              <label><span>角色描述</span><textarea name="description" required maxlength="500" rows="3" placeholder="描述角色身份、外观和视觉风格…"></textarea></label>
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
            <div class="node-generation__dots" aria-label="母版候选实时到达">${Array.from({ length: 81 }, (_, i) => {
              const x = i % 9 - 4, y = Math.floor(i / 9) - 4
              const ring = Math.max(Math.abs(x), Math.abs(y))
              return `<i class="dot-ring-${ring}"></i>`
            }).join('')}</div>
            <small class="node-hint">正在生成 6 张候选母版…</small>
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
          bodyHtml = `
            <div class="node-status node-status--active"><span>确认候选</span><b>${statusLabel}</b></div>
            <p class="node-desc">从候选中选择一张作为身份母版。</p>
            <div class="node-candidate-list">
              <button type="button" class="node-candidate" data-select-candidate="0"><small>候选 01</small></button>
              <button type="button" class="node-candidate" data-select-candidate="1"><small>候选 02</small></button>
              <button type="button" class="node-candidate" data-select-candidate="2"><small>候选 03</small></button>
              <button type="button" class="node-candidate" data-select-candidate="3"><small>候选 04</small></button>
              <button type="button" class="node-candidate" data-select-candidate="4"><small>候选 05</small></button>
              <button type="button" class="node-candidate" data-select-candidate="5"><small>候选 06</small></button>
            </div>
            <button type="button" class="node-action" data-confirm-candidate="" data-connection-required="character-template:template-candidate">确认候选</button>
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

      case 'action-setup':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>动作设定</span><b>${statusLabel}</b></div>
            <p class="node-desc">选择要生成的动作类型。</p>
            <div class="node-action-list">
              <button type="button" class="node-action-option" data-action-type="walk" data-connection-required="template-candidate:action-setup">
                <strong>Walk</strong>
                <small>行走循环动画</small>
              </button>
              <button type="button" class="node-action-option" data-action-type="idle" data-connection-required="template-candidate:action-setup">
                <strong>Idle</strong>
                <small>待机动画</small>
              </button>
            </div>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>动作设定</span><b>${statusLabel}</b></div>
            <p class="node-desc">已选择动作类型。</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>动作设定</span><b>${statusLabel}</b></div>`
        }
        break

      case 'first-frame':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>生成首帧</span><b>生成中…</b></div>
            <div class="node-generating"><i class="pulse"></i><small>正在生成动作首帧…</small></div>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>生成首帧</span><b>${statusLabel}</b></div>
            <p class="node-desc">首帧已生成，确认后开始完整动画。</p>
            <button type="button" class="node-action" data-confirm-keyframe="" data-connection-required="action-setup:first-frame">确认首帧</button>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>生成首帧</span><b>${statusLabel}</b></div>`
        }
        break

      case 'complete-animation':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>生成动画</span><b>生成中…</b></div>
            <div class="node-generating"><i class="pulse"></i><small>正在生成 8 帧动画…</small></div>
            <div class="node-frame-strip">
              ${Array.from({ length: 8 }, (_, i) => `<span class="is-pending"><small>${String(i + 1).padStart(2, '0')}</small></span>`).join('')}
            </div>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>生成动画</span><b>${statusLabel}</b></div>
            <div class="node-frame-strip">
              ${Array.from({ length: 8 }, (_, i) => `<span class="is-arrived"><small>${String(i + 1).padStart(2, '0')}</small></span>`).join('')}
            </div>
            <button type="button" class="node-action" data-confirm-animation="" data-connection-required="first-frame:complete-animation">确认动画</button>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>生成动画</span><b>${statusLabel}</b></div>`
        }
        break

      case 'review':
        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>审核</span><b>${statusLabel}</b></div>
            <p class="node-desc">检查所有动作是否符合预期。</p>
            <button type="button" class="node-action" data-confirm-review="" data-connection-required="complete-animation:review">审核通过</button>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>审核</span><b>${statusLabel}</b></div>
            <p class="node-desc">已通过审核。</p>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>审核</span><b>${statusLabel}</b></div>`
        }
        break

      case 'export': {
        const character = workflowRunToCharacter(run)
        const playtestUrl = character ? buildPlaytestUrl(character) : '/playtest/demo'
        const exportReady = canExportToPlaytest(run)

        if (isActive) {
          bodyHtml = `
            <div class="node-status node-status--active"><span>导出</span><b>${statusLabel}</b></div>
            <p class="node-desc">${exportReady ? '资产已就绪，选择导出方式。' : '等待上游步骤完成。'}</p>
            <div class="node-export-options">
              <a class="node-action${exportReady ? '' : ' is-disabled'}" href="${playtestUrl}" ${exportReady ? 'data-export-to-playtest=""' : 'aria-disabled="true"'}>
                <strong>导出到 Playtest 预览</strong>
                <small>在预览台检查动作播放与循环效果</small>
              </a>
              <button type="button" class="node-action node-action--secondary" data-export-pack="" ${exportReady ? '' : 'disabled'}>
                <strong>导出资产</strong>
                <small>下载 Sprite Sheet 与 animation.json</small>
              </button>
            </div>
          `
        } else if (isPassed) {
          bodyHtml = `
            <div class="node-status node-status--passed"><span>导出</span><b>已完成</b></div>
            <p class="node-desc">全部完成！</p>
            <div class="node-export-options">
              <a class="node-action" href="${playtestUrl}" data-export-to-playtest="">
                <strong>导出到 Playtest 预览</strong>
                <small>在预览台检查动作播放与循环效果</small>
              </a>
              <button type="button" class="node-action node-action--secondary" data-export-pack="">
                <strong>导出资产</strong>
                <small>下载 Sprite Sheet 与 animation.json</small>
              </button>
            </div>
          `
        } else {
          bodyHtml = `<div class="node-status node-status--${step.status}"><span>导出</span><b>${statusLabel}</b></div>`
        }
        break
      }

      default:
        bodyHtml = `<div class="node-status node-status--${step.status}"><span>${meta.title}</span><b>${statusLabel}</b></div>`
    }
  }

  const hasInput = step.type !== 'character-setup'
  const hasOutput = step.type !== 'export'
  const outputEnabled = isPassed || isActive

  return `
    <article class="graph-node${hasInput ? ' has-input' : ''}" data-node-id="${step.type}" data-x="${pos.x}" data-y="${pos.y}" style="left:${pos.x}px;top:${pos.y}px">
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

export function WorkflowCanvas({ controller, run, unavailableReason, onStepAction }: WorkflowCanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const revision = getCurrentRevision(run)

  // 渲染连线 + 同步连接门控
  useEffect(() => {
    if (!revision) return
    controller.renderWires()

    // 连接门控：禁用 data-connection-required 按钮直到连接建立
    rootRef.current?.querySelectorAll('[data-connection-required]').forEach((el) => {
      const requirements = (el as HTMLElement).dataset.connectionRequired!.split(',')
      const connected = requirements.every((req) => controller.connections.has(req.trim()))
      ;(el as HTMLButtonElement).disabled = !connected
      el.closest('[data-node-id]')?.classList.toggle('is-waiting-connection', !connected)
    })
  }, [controller, revision])

  // 绑定交互事件
  useEffect(() => {
    if (!rootRef.current || !revision) return
    controller.attach(rootRef.current)
    const root = rootRef.current

    // 跳过步骤按钮
    root.querySelectorAll('[data-skip-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const stepEl = btn.closest('[data-node-id]') as HTMLElement
        const stepType = stepEl?.dataset.nodeId
        if (stepType) onStepAction?.(stepType, 'skip')
      })
    })

    return () => controller.detach()
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
          <button type="button" aria-label="缩小画布" data-node-zoom-out="">−</button>
          <output data-node-zoom-label="">100%</output>
          <button type="button" aria-label="放大画布" data-node-zoom-in="">+</button>
          <button type="button" aria-label="整理节点" data-node-arrange="">↺</button>
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
