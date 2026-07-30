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
