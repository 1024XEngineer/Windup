import type { WorkflowCommand, WorkflowRun } from '../model/types'
import type { WorkflowStep, WorkflowStepType } from '../model/types'
import { availableCommands } from '../model/selectors'
import { loadRun, saveRun } from './local-store'

/**
 * 提交一条命令并推进状态。
 *
 * 后端暂时不存 workflow，本地骨架同步执行命令并保存结果。真实生成任务
 * 接入后，generate 类命令会先产生 running/taskId，再由任务终态推进。
 */
export async function submitWorkflowStep(
  runId: string,
  command: WorkflowCommand,
): Promise<WorkflowRun> {
  const run = loadRun(runId)
  if (!run) throw new Error(`工作流 ${runId} 不存在`)

  if (!availableCommands(run).includes(command.kind)) {
    throw new Error(`工作流 ${runId} 当前不允许命令 ${command.kind}`)
  }

  if (command.kind === 'finish') {
    return saveRun({ ...run, currentStepId: null, status: 'completed' })
  }

  let steps: WorkflowStep[]

  switch (command.kind) {
    case 'generate-template':
      steps = completeOrAppendStep(run.steps, 'generate-template')
      break
    case 'confirm-template':
      steps = completePendingStep(run.steps, 'confirm-template')
      break
    case 'add-action': {
      const actionId = nextActionId(run.steps)
      const firstStepNumber = nextStepNumber(run.steps)
      steps = [
        ...run.steps,
        doneStep(firstStepNumber, 'add-action', actionId),
        pendingStep(firstStepNumber + 1, 'generate-action', actionId),
      ]
      break
    }
    case 'generate-action':
      steps = run.steps.map((step) =>
        step.type === 'generate-action' &&
        step.actionId === command.actionId &&
        step.status === 'pending'
          ? { ...step, status: 'done' as const }
          : step,
      )
      if (steps.every((step, index) => step === run.steps[index])) {
        throw new Error(`动作 ${command.actionId} 没有待生成的工作流步骤`)
      }
      break
    case 'reject-frame': {
      const stepNumber = nextStepNumber(run.steps)
      steps = [...run.steps, doneStep(stepNumber, 'review', command.actionId)]
      break
    }
  }

  const next = steps.find((step) => step.status === 'pending')

  // 没有待办不等于已完成：用户还可以继续加动作，收尾必须显式提交 finish。
  // 因此这里只在确有待办时置为 running，其余保持原状态，不硬编码。
  return saveRun({
    ...run,
    steps,
    currentStepId: next?.id ?? null,
    status: next ? 'running' : run.status,
  })
}

function completePendingStep(steps: WorkflowStep[], type: WorkflowStepType): WorkflowStep[] {
  const target = steps.find((step) => step.type === type && step.status === 'pending')
  if (!target) throw new Error(`没有待执行的 ${type} 步骤`)
  return steps.map((step) =>
    step.id === target.id ? { ...step, status: 'done' as const } : step,
  )
}

function completeOrAppendStep(steps: WorkflowStep[], type: WorkflowStepType): WorkflowStep[] {
  const target = steps.find((step) => step.type === type && step.status === 'pending')
  if (target) {
    return steps.map((step) =>
      step.id === target.id ? { ...step, status: 'done' as const } : step,
    )
  }
  return [...steps, doneStep(nextStepNumber(steps), type, null)]
}

function nextStepNumber(steps: WorkflowStep[]): number {
  return (
    Math.max(
      0,
      ...steps.map((step) => Number(/^step-(\d+)$/.exec(step.id)?.[1] ?? 0)),
    ) + 1
  )
}

function nextActionId(steps: WorkflowStep[]): number {
  return Math.max(0, ...steps.map((step) => step.actionId ?? 0)) + 1
}

function doneStep(number: number, type: WorkflowStepType, actionId: number | null): WorkflowStep {
  return { id: `step-${number}`, type, status: 'done', actionId, taskId: null }
}

function pendingStep(number: number, type: WorkflowStepType, actionId: number): WorkflowStep {
  return { id: `step-${number}`, type, status: 'pending', actionId, taskId: null }
}
