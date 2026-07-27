import type {
  WorkflowCommand,
  WorkflowCommandKind,
  WorkflowLocation,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepType,
} from './types'

/**
 * 当前步骤等纯计算。AI 自动与用户手动两个入口读的是同一份规则。
 * 纯函数，不碰网络也不碰界面。
 */

function stepsOfType(run: WorkflowRun, type: WorkflowStepType): WorkflowStep[] {
  return run.steps.filter((step) => step.type === type)
}

function isDone(steps: WorkflowStep[]): boolean {
  return steps.length > 0 && steps.every((step) => step.status === 'done')
}

/** 当前停在哪一步。 */
export function currentStep(run: WorkflowRun): WorkflowStep | null {
  return run.steps.find((step) => step.id === run.currentStepId) ?? null
}

/** 此刻允许执行哪些命令。界面用它决定按钮状态，AI 用它约束自己不越步。 */
export function availableCommands(run: WorkflowRun): WorkflowCommandKind[] {
  if (run.status === 'completed' || run.status === 'failed') return []
  // 有任务在跑时不接新命令，避免连点产生重复任务
  if (run.steps.some((step) => step.status === 'running')) return []

  const templateDone = isDone(stepsOfType(run, 'generate-template'))
  const templateConfirmed = isDone(stepsOfType(run, 'confirm-template'))
  const added = stepsOfType(run, 'add-action')
  const generated = stepsOfType(run, 'generate-action')

  if (!templateDone) return ['generate-template']
  if (!templateConfirmed) return ['confirm-template', 'generate-template']

  const commands: WorkflowCommandKind[] = ['add-action']
  // 两个条件都需要：本地 submitWorkflowStep 成对追加 add-action(done) 与
  // generate-action(pending)，走第一个条件；后端接管 workflow 后步骤未必成对，
  // 可能只有 add-action 而没有对应的生成步骤，那时靠第二个条件兜住。
  if (generated.some((step) => step.status === 'pending') || added.length > generated.length) {
    commands.push('generate-action')
  }
  // 生成过动作才谈得上退回与收尾
  if (generated.some((step) => step.status === 'done')) {
    commands.push('reject-frame', 'finish')
  }
  return commands
}

/**
 * AI 自动驱动时下一步做什么。手动驱动时由用户选。
 * @param plan AI 解析那句话得到的计划：母版描述 + 要哪些动作。
 */
export function suggestNextCommand(
  run: WorkflowRun,
  plan: { description: string; actionNames: string[] },
): WorkflowCommand | null {
  const allowed = availableCommands(run)
  if (allowed.length === 0) return null

  if (allowed.includes('generate-template') && !isDone(stepsOfType(run, 'generate-template'))) {
    return { kind: 'generate-template', description: plan.description }
  }
  if (allowed.includes('confirm-template')) return { kind: 'confirm-template' }

  const added = stepsOfType(run, 'add-action')
  if (added.length < plan.actionNames.length) {
    return { kind: 'add-action', name: plan.actionNames[added.length], source: 'preset' }
  }

  const pending = run.steps.find(
    (step) => step.type === 'generate-action' && step.status === 'pending',
  )
  if (pending && pending.actionId !== null) {
    return { kind: 'generate-action', actionId: pending.actionId }
  }

  return allowed.includes('finish') ? { kind: 'finish' } : null
}

/** 审核台点「重新生成此帧」时用，拿返回值跳回编辑器定位。 */
export function locateFrame(
  run: WorkflowRun,
  actionId: number,
  frameIndex: number,
): WorkflowLocation | null {
  const step = run.steps.find(
    (item) => item.type === 'generate-action' && item.actionId === actionId,
  )
  if (!step) return null
  return { runId: run.id, stepId: step.id, actionId, frameIndex }
}
