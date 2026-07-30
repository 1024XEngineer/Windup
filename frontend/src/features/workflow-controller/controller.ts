import type {
  CharacterSetupStepInput,
  GenerationApis,
  TaskApis,
  WorkflowRun,
  WorkflowRunStore,
} from '@/entities'
import { createCharacterTemplateTask } from './character-template-task'
import {
  advanceCharacterSetupState,
  createWorkflowRunState,
  getActiveStep,
  getCurrentRevision,
  interruptWorkflowRunState,
  requireActiveWorkflow,
  updateCharacterSetupState,
  type CreateWorkflowRunStateInput,
} from './workflow-state'

/** 首个纵切只开放创建角色；增加动作进入对应步骤实现时再加入 Controller。 */
export type CreateWorkflowControllerInput = CreateWorkflowRunStateInput

export interface WorkflowController {
  /** 创建并保存一条纯前端运行记录。 */
  create(input: CreateWorkflowControllerInput): WorkflowRun

  /** 按路由中的 runId 读取快照；不存在时返回 null。 */
  getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null

  /** 订阅指定运行记录的本地变化。 */
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void

  /** 修改当前角色资料步骤，页面无需知道步骤内部 ID。 */
  updateCharacterSetup(runId: WorkflowRun['id'], input: CharacterSetupStepInput): WorkflowRun

  /**
   * 推进一个步骤。当前纵切只实现角色资料到角色图生成；
   * 后续步骤进入各自实现 PR 后再扩展，不在这里伪造完成。
   */
  nextStep(runId: WorkflowRun['id']): Promise<WorkflowRun>

  /** 页面恢复时先读取任务终态；仍在运行时再恢复订阅。 */
  resume(runId: WorkflowRun['id']): Promise<WorkflowRun | null>

  /** 只停止前端自动推进和任务订阅；后端当前没有取消任务能力。 */
  interrupt(runId: WorkflowRun['id']): WorkflowRun
}

export interface CreateWorkflowControllerOptions {
  store: WorkflowRunStore
  generationApis: Pick<GenerationApis, 'create'>
  taskApis: TaskApis
  /** 测试可注入确定性 ID；生产默认使用浏览器随机 UUID。 */
  createId?: (scope: 'run' | 'revision' | 'submission') => string
  /** 测试可注入确定性时间。 */
  now?: () => string
}

/**
 * Quick Start 与手动工作流共用的流程协调器。
 *
 * Controller 只负责读取当前步骤、保存状态并委派角色图任务；纯状态转换和异步任务
 * 生命周期分别留在本 Feature 的内部模块。生产接入必须复用同一个 Controller 实例，
 * 不能在组件渲染期间重复创建。
 */
export function createWorkflowController({
  store,
  generationApis,
  taskApis,
  createId = createRuntimeId,
  now = () => new Date().toISOString(),
}: CreateWorkflowControllerOptions): WorkflowController {
  const characterTemplateTask = createCharacterTemplateTask({
    store,
    generationApis,
    taskApis,
    createSubmissionId: () => createId('submission'),
  })

  function getWorkflow(runId: WorkflowRun['id']) {
    return store.get(runId)
  }

  function requireWorkflow(runId: WorkflowRun['id']) {
    const run = getWorkflow(runId)
    if (!run) throw new Error(`WorkflowRun 不存在：${runId}`)
    return run
  }

  function save(run: WorkflowRun) {
    store.save(run)
    return run
  }

  function create(input: CreateWorkflowControllerInput): WorkflowRun {
    return save(
      createWorkflowRunState(input, {
        runId: createId('run'),
        revisionId: createId('revision'),
        createdAt: now(),
      }),
    )
  }

  function subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void) {
    return store.subscribe(runId, listener)
  }

  function updateCharacterSetup(
    runId: WorkflowRun['id'],
    input: CharacterSetupStepInput,
  ): WorkflowRun {
    return save(updateCharacterSetupState(requireWorkflow(runId), input))
  }

  async function nextStep(runId: WorkflowRun['id']): Promise<WorkflowRun> {
    const run = requireActiveWorkflow(requireWorkflow(runId))
    const revision = getCurrentRevision(run)
    const activeStep = getActiveStep(revision)
    if (!activeStep) throw new Error('当前 WorkflowRun 没有 active 步骤')

    if (activeStep.type === 'character-template') {
      return characterTemplateTask.start(runId, {
        revisionId: revision.id,
        stepId: activeStep.id,
      })
    }
    if (activeStep.type !== 'character-setup') {
      throw new Error(`步骤 ${activeStep.type} 尚未进入本轮实现`)
    }

    const transitioned = advanceCharacterSetupState(run)
    save(transitioned.run)
    return characterTemplateTask.start(runId, transitioned.target)
  }

  function resume(runId: WorkflowRun['id']) {
    return characterTemplateTask.resume(runId)
  }

  function interrupt(runId: WorkflowRun['id']): WorkflowRun {
    const run = requireWorkflow(runId)
    if (run.status !== 'active') return run

    characterTemplateTask.stop(runId)
    const latest = requireWorkflow(runId)
    if (latest.status !== 'active') return latest
    return save(interruptWorkflowRunState(latest))
  }

  return {
    create,
    getWorkflow,
    subscribe,
    updateCharacterSetup,
    nextStep,
    resume,
    interrupt,
  }
}

function createRuntimeId(scope: 'run' | 'revision' | 'submission') {
  const suffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${scope}-${suffix}`
}
