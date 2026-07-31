import {
  WORKFLOW_STEP_ORDER,
  type CharacterSetupStepInput,
  type CharacterTemplateGenerationInput,
  type CreateWorkflowRunInput,
  type WorkflowRevision,
  type WorkflowRun,
  type WorkflowStep,
  type WorkflowStepStatus,
  type WorkflowStepType,
} from '@/entities'

export type CreateWorkflowRunStateInput = Extract<
  CreateWorkflowRunInput,
  { purpose: 'create_character' }
>

export interface CreateWorkflowRunStateOptions {
  runId: WorkflowRun['id']
  revisionId: WorkflowRevision['id']
  createdAt: string
}

export interface WorkflowStepTarget {
  revisionId: WorkflowRevision['id']
  stepId: WorkflowStep['id']
}

export interface RestartWorkflowRunStateOptions {
  revisionId: WorkflowRevision['id']
  createdAt: string
}

export function createWorkflowRunState(
  input: CreateWorkflowRunStateInput,
  { runId, revisionId, createdAt }: CreateWorkflowRunStateOptions,
): WorkflowRun {
  const prompt = input.prompt?.trim() || null

  return {
    id: runId,
    projectId: input.projectId,
    characterId: null,
    outfitId: null,
    purpose: input.purpose,
    driver: input.driver,
    status: 'active',
    currentRevisionId: revisionId,
    revisions: [
      {
        id: revisionId,
        basedOnRevisionId: null,
        restartStepId: null,
        status: 'active',
        steps: WORKFLOW_STEP_ORDER.map((type, index) =>
          createInitialStep(type, revisionId, index, prompt),
        ),
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        createdAt,
      },
    ],
    prompt,
  }
}

export function getCurrentRevision(run: WorkflowRun): WorkflowRevision {
  const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
  if (!revision) throw new Error(`WorkflowRun ${run.id} 的 currentRevisionId 无效`)
  return revision
}

export function getActiveStep(revision: WorkflowRevision): WorkflowStep | null {
  return revision.steps.find((step) => step.status === 'active') ?? null
}

export function requireActiveWorkflow(run: WorkflowRun): WorkflowRun {
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可推进：${run.status}`)
  return run
}

export function replaceWorkflowStep(
  run: WorkflowRun,
  revisionId: WorkflowRevision['id'],
  stepId: WorkflowStep['id'],
  update: (step: WorkflowStep) => WorkflowStep,
  revisionUpdate?: (revision: WorkflowRevision) => WorkflowRevision,
): WorkflowRun {
  return {
    ...run,
    revisions: run.revisions.map((revision) => {
      if (revision.id !== revisionId) return revision
      const nextRevision = {
        ...revision,
        steps: revision.steps.map((step) => (step.id === stepId ? update(step) : step)),
      }
      return revisionUpdate ? revisionUpdate(nextRevision) : nextRevision
    }),
  }
}

export function updateCharacterSetupState(
  workflow: WorkflowRun,
  input: CharacterSetupStepInput,
): WorkflowRun {
  const run = requireActiveWorkflow(workflow)
  const revision = getCurrentRevision(run)
  const step = revision.steps.find((item) => item.type === 'character-setup')
  if (!step || step.type !== 'character-setup' || step.status !== 'active') {
    throw new Error('当前只能更新处于 active 状态的角色资料步骤')
  }

  const description = input.description.trim()
  if (!description) throw new Error('角色描述不能为空')

  return replaceWorkflowStep(run, revision.id, step.id, (current) => {
    if (current.type !== 'character-setup') return current
    return {
      ...current,
      input: {
        description,
        referenceMedia: [...input.referenceMedia],
      },
    }
  })
}

export function advanceCharacterSetupState(workflow: WorkflowRun): {
  run: WorkflowRun
  target: WorkflowStepTarget
} {
  const run = requireActiveWorkflow(workflow)
  const revision = getCurrentRevision(run)
  const activeStep = getActiveStep(revision)
  if (!activeStep) throw new Error('当前 WorkflowRun 没有 active 步骤')
  if (activeStep.type !== 'character-setup') {
    throw new Error(`当前步骤不是角色资料：${activeStep.type}`)
  }
  if (!activeStep.input) throw new Error('请先填写角色资料')

  const templateStep = revision.steps.find((step) => step.type === 'character-template')
  if (!templateStep) throw new Error('WorkflowRun 缺少 character-template 步骤')

  const generationInput: CharacterTemplateGenerationInput = {
    type: 'character_template',
    projectId: run.projectId,
    prompt: activeStep.input.description,
    referenceMedia: activeStep.input.referenceMedia,
  }

  return {
    run: {
      ...run,
      revisions: run.revisions.map((item) => {
        if (item.id !== revision.id) return item
        return {
          ...item,
          generationStatus: 'in_progress' as const,
          steps: item.steps.map((step) => {
            if (step.id === activeStep.id) return { ...step, status: 'passed' as const }
            if (step.id !== templateStep.id || step.type !== 'character-template') return step
            return {
              ...step,
              status: 'active' as const,
              input: generationInput,
            }
          }),
        }
      }),
    },
    target: {
      revisionId: revision.id,
      stepId: templateStep.id,
    },
  }
}

export function interruptWorkflowRunState(run: WorkflowRun): WorkflowRun {
  return run.status === 'active' ? { ...run, status: 'interrupted' } : run
}

/**
 * 从已通过节点开启新的执行线。
 *
 * 旧 Revision 保留为只读历史；重开点之前的结果作为新线参考，重开点及之后的结果
 * 不会进入新线。流程节点始终固定为五个，因此“移除下游”在数据中表现为清空它们的
 * 输入、输出与引用，并重新锁定。
 */
export function restartWorkflowRunState(
  run: WorkflowRun,
  restartStepId: WorkflowStep['id'],
  { revisionId, createdAt }: RestartWorkflowRunStateOptions,
): WorkflowRun {
  const sourceRevision = getCurrentRevision(run)
  const restartIndex = sourceRevision.steps.findIndex((step) => step.id === restartStepId)
  const restartStep = sourceRevision.steps[restartIndex]
  if (!restartStep || restartStep.status !== 'passed') {
    throw new Error('只能从已通过的步骤重新开始')
  }

  const steps = sourceRevision.steps.map((step, index) => {
    if (index < restartIndex) return copyReferenceStep(step, revisionId)
    if (index === restartIndex) return createRestartStep(step, revisionId)

    return lockFreshStep(step.type, revisionId, index, run.prompt)
  })

  const revision: WorkflowRevision = {
    id: revisionId,
    basedOnRevisionId: sourceRevision.id,
    restartStepId: restartStep.id,
    status: 'active',
    steps,
    generationStatus: 'not_started',
    exportStatus: 'not_exported',
    createdAt,
  }

  return {
    ...run,
    status: 'active',
    currentRevisionId: revision.id,
    revisions: [
      ...run.revisions.map((item) =>
        item.id === sourceRevision.id ? { ...item, status: 'abandoned' as const } : item,
      ),
      revision,
    ],
  }
}

function copyReferenceStep(step: WorkflowStep, revisionId: WorkflowRevision['id']): WorkflowStep {
  const source = structuredClone(step)
  return {
    ...source,
    id: `${revisionId}:${source.type}`,
    status: 'passed',
    taskId: null,
    submissionId: null,
    error: null,
    referenceStepIds: [step.id],
  }
}

function createRestartStep(step: WorkflowStep, revisionId: WorkflowRevision['id']): WorkflowStep {
  const source = structuredClone(step)
  return {
    ...source,
    id: `${revisionId}:${source.type}`,
    status: 'active',
    taskId: null,
    submissionId: null,
    error: null,
    output: null,
    referenceStepIds: [step.id],
  } as WorkflowStep
}

function lockFreshStep(
  type: WorkflowStepType,
  revisionId: WorkflowRevision['id'],
  index: number,
  prompt: string | null,
): WorkflowStep {
  return {
    ...createInitialStep(type, revisionId, index, prompt),
    status: 'locked',
    referenceStepIds: [],
  }
}

function createInitialStep(
  type: WorkflowStepType,
  revisionId: string,
  index: number,
  prompt: string | null,
): WorkflowStep {
  const status: WorkflowStepStatus = index === 0 ? 'active' : 'locked'
  const base: {
    id: string
    status: WorkflowStepStatus
    taskId: null
    submissionId: null
    error: null
    referenceStepIds: string[]
  } = {
    id: `${revisionId}:${type}`,
    status,
    taskId: null,
    submissionId: null,
    error: null,
    referenceStepIds: [],
  }

  if (type === 'character-setup') {
    return {
      ...base,
      type,
      input: prompt ? { description: prompt, referenceMedia: [] } : null,
      output: null,
    }
  }
  if (type === 'character-template') {
    return {
      ...base,
      type,
      input: null,
      output: null,
    }
  }
  return { ...base, type, input: null, output: null } as WorkflowStep
}
