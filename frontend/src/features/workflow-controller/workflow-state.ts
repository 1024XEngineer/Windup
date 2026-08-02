import {
  WORKFLOW_STEP_ORDER,
  type CharacterSetupStepInput,
  type CharacterTemplateGenerationInput,
  type CompleteAnimationGenerationInput,
  type CompleteAnimationGenerationResult,
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

export function advanceCharacterSetupState(
  workflow: WorkflowRun,
  spriteSize: { width: number; height: number },
): {
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
    spriteWidth: spriteSize.width,
    spriteHeight: spriteSize.height,
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

/**
 * 确认候选选择：标记 template-candidate 为 passed，激活下一个步骤。
 */
export function confirmCandidateState(run: WorkflowRun, selectedImageUrl: string): WorkflowRun {
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可推进：${run.status}`)
  const revision = getCurrentRevision(run)
  const candidateStep = revision.steps.find((step) => step.type === 'template-candidate')
  if (!candidateStep || candidateStep.status !== 'active') {
    throw new Error('当前只能确认处于 active 状态的候选步骤')
  }

  const nextIndex = WORKFLOW_STEP_ORDER.indexOf('template-candidate') + 1
  const nextType = WORKFLOW_STEP_ORDER[nextIndex]

  return {
    ...run,
    revisions: run.revisions.map((item) => {
      if (item.id !== revision.id) return item
      return {
        ...item,
        steps: item.steps.map((step) => {
          if (step.id === candidateStep.id && step.type === 'template-candidate') {
            return {
              ...step,
              status: 'passed' as const,
              output: { selectedImageUrl },
            }
          }
          if (nextType && step.type === nextType) {
            return { ...step, status: 'active' as const }
          }
          return step
        }),
      }
    }),
  }
}

/**
 * 动作生成完成：与 confirmCandidateState 对称。
 *
 * 成功时把 action-generation 标记 passed 并激活 review 步骤；失败时标记 failed
 * 并把整个 run 置为 failed。两个方向都保证「active 状态的 run 恰好有一个 active
 * 步骤」，让刷新后的存储校验能够恢复这条运行记录。
 */
export function completeActionGenerationState(
  run: WorkflowRun,
  result: CompleteAnimationGenerationResult | { error: string },
): WorkflowRun {
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可完成动作生成：${run.status}`)
  const revision = getCurrentRevision(run)
  const actionStep = revision.steps.find((step) => step.type === 'action-generation')
  if (!actionStep || actionStep.status !== 'active') {
    throw new Error('当前只能完成处于 active 状态的动作生成步骤')
  }

  const failed = result !== null && typeof result === 'object' && 'error' in result
  const reviewStep = revision.steps.find((step) => step.type === 'review')

  const updated = replaceWorkflowStep(
    run,
    revision.id,
    actionStep.id,
    (current) => {
      if (current.type !== 'action-generation') return current
      return {
        ...current,
        status: failed ? ('failed' as const) : ('passed' as const),
        output: failed ? null : result,
        error: failed ? String((result as { error: string }).error) : null,
        // 任务已终态，解除任务 ID 关联（存储校验要求终态步骤不持有任务 ID）
        taskId: null,
        submissionId: null,
      }
    },
    (current) => ({
      ...current,
      status: failed ? ('failed' as const) : current.status,
      generationStatus: failed ? ('failed' as const) : ('completed' as const),
      steps: current.steps.map((step) => {
        if (failed || !reviewStep || step.id !== reviewStep.id || step.type !== 'review') {
          return step
        }
        return { ...step, status: 'active' as const }
      }),
    }),
  )

  return failed ? { ...updated, status: 'failed' as const } : updated
}

/** 审核通过后结束当前版本和整条运行；发布与下载仍由后续独立功能处理。 */
export function approveReviewState(run: WorkflowRun): WorkflowRun {
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可审核：${run.status}`)
  const revision = getCurrentRevision(run)
  const reviewStep = revision.steps.find((step) => step.type === 'review')
  if (!reviewStep || reviewStep.status !== 'active') {
    throw new Error('当前只能通过处于 active 状态的审核步骤')
  }

  return {
    ...run,
    status: 'completed',
    revisions: run.revisions.map((item) =>
      item.id === revision.id
        ? {
            ...item,
            status: 'completed',
            steps: item.steps.map((step) =>
              step.id === reviewStep.id
                ? { ...step, status: 'passed' as const, error: null }
                : step,
            ),
          }
        : item,
    ),
  }
}

/**
 * 记录动作生成任务 ID：步骤保持 active，只是把 taskId 落盘，供刷新后 resume 恢复。
 */
export function beginActionGenerationState(
  run: WorkflowRun,
  input: CompleteAnimationGenerationInput,
  submissionId: string,
): WorkflowRun {
  const revision = getCurrentRevision(requireActiveWorkflow(run))
  const actionStep = revision.steps.find((step) => step.type === 'action-generation')
  if (!actionStep || actionStep.status !== 'active' || actionStep.taskId) {
    throw new Error('当前动作生成步骤不可重复提交')
  }
  return replaceWorkflowStep(run, revision.id, actionStep.id, (current) => {
    if (current.type !== 'action-generation') return current
    return { ...current, input, submissionId, error: null }
  })
}

export function recordActionGenerationTaskState(
  run: WorkflowRun,
  taskId: string,
  input?: CompleteAnimationGenerationInput,
): WorkflowRun {
  if (run.status !== 'active' && run.status !== 'interrupted') {
    throw new Error(`WorkflowRun 当前不可记录任务：${run.status}`)
  }
  const revision = getCurrentRevision(run)
  const actionStep = revision.steps.find((step) => step.type === 'action-generation')
  if (!actionStep || actionStep.status !== 'active') {
    throw new Error('当前只能为 active 状态的动作生成步骤记录任务')
  }
  return replaceWorkflowStep(run, revision.id, actionStep.id, (current) => {
    if (current.type !== 'action-generation') return current
    return { ...current, taskId, input: input ?? current.input, submissionId: null }
  })
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
