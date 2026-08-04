/**
 * 创作页面与 WorkflowRun Entity 之间的协调层。
 *
 * WorkflowRun Service 已经负责步骤迁移、Generation 调用和 Character 写入；
 * Controller 只把这些用例整理成页面命令，并在刷新时根据当前步骤选择
 * 正确的恢复入口。它不拥有第二份流程状态，也不直接调用 store.save()。
 */

import type {
  ActionFirstFrameCandidateBatch,
  ActionReviewResult,
  CharacterCandidateBatch,
  ConfirmActionFirstFrameInput,
  ConfirmCharacterSelectionInput,
  PublishActionResult,
  StartActionRunInput,
  StartCharacterRunInput,
  WorkflowRun,
  WorkflowRunService,
  WorkflowRunStore,
  WorkflowStep,
} from '@/entities'

/**
 * 页面恢复结果。
 *
 * 候选阶段携带当次从后端取回的临时 URL；动作审核阶段携带完整动画帧。
 * 页面用 phase 选择界面，无需自己解释步骤顺序或后端任务状态。
 */
export type WorkflowControllerSnapshot =
  | { phase: 'character-setup'; run: WorkflowRun }
  | ({ phase: 'character-candidates' } & CharacterCandidateBatch)
  | { phase: 'action-setup'; run: WorkflowRun }
  | ({ phase: 'action-first-frame-candidates' } & ActionFirstFrameCandidateBatch)
  | ({ phase: 'action-review' } & ActionReviewResult)
  | { phase: 'terminal'; run: WorkflowRun }

export interface WorkflowController {
  /** 开始角色任务，完成后返回 4 张角色候选。 */
  startCharacter(input: StartCharacterRunInput): Promise<CharacterCandidateBatch>
  /** 确认角色候选；正式保存成功后角色 Run 完成。 */
  confirmCharacter(input: ConfirmCharacterSelectionInput): Promise<WorkflowRun>
  /** 用户点击生成动作时创建独立 Run，返回 4 张动作首帧候选。 */
  startAction(input: StartActionRunInput): Promise<ActionFirstFrameCandidateBatch>
  /** 选中 1 张首帧后生成完整动画，并返回审核页可直接播放的有序帧。 */
  confirmActionFirstFrame(input: ConfirmActionFirstFrameInput): Promise<ActionReviewResult>
  /** 审核通过后写入 Character，返回导入 Playtest 所需的稳定 ID。 */
  approveAction(runId: WorkflowRun['id']): Promise<PublishActionResult>

  /** 按 ID 读取防御性快照；不存在时返回 null。 */
  getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null
  /** 列出全部 Run，可选按项目过滤，供后续历史页使用。 */
  listWorkflows(projectId?: string): WorkflowRun[]
  /** 订阅单个 Run；Controller 不额外缓存副本。 */
  subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void): () => void
  /** 订阅列表变化，供后续项目/历史视图复用。 */
  subscribeAll(listener: (runs: WorkflowRun[]) => void): () => void

  /**
   * 页面刷新或路由重进时的唯一恢复入口。
   * Controller 只分流，真正的 taskId 查询、订阅和结果校验由 Service 完成。
   */
  resume(runId: WorkflowRun['id']): Promise<WorkflowControllerSnapshot | null>
}

export interface CreateWorkflowControllerOptions {
  /** 当前 WorkflowRun 快照的统一读取边界；Controller 只读取和订阅。 */
  store: WorkflowRunStore
  /** 作为唯一业务写入入口，Controller 不复制其逻辑。 */
  service: WorkflowRunService
}

export function createWorkflowController({
  store,
  service,
}: CreateWorkflowControllerOptions): WorkflowController {
  function getWorkflow(runId: WorkflowRun['id']): WorkflowRun | null {
    return store.get(runId)
  }

  function listWorkflows(projectId?: string): WorkflowRun[] {
    const runs = store.list()
    return projectId === undefined ? runs : runs.filter((run) => run.projectId === projectId)
  }

  function subscribe(runId: WorkflowRun['id'], listener: (run: WorkflowRun) => void) {
    return store.subscribe(runId, listener)
  }

  function subscribeAll(listener: (runs: WorkflowRun[]) => void) {
    return store.subscribeAll(listener)
  }

  async function resume(runId: WorkflowRun['id']): Promise<WorkflowControllerSnapshot | null> {
    const run = store.get(runId)
    if (!run) return null
    if (run.status !== 'active') return { phase: 'terminal', run }

    const activeStep = getActiveStep(run)
    if (run.purpose === 'create_character') {
      if (activeStep.type === 'character-setup') return { phase: 'character-setup', run }
      if (activeStep.type !== 'character-template' && activeStep.type !== 'template-candidate') {
        throw new Error(`角色 WorkflowRun 无法恢复未知步骤：${activeStep.type}`)
      }
      const batch = await service.resumeCharacterCandidates(run.id)
      return { phase: 'character-candidates', ...batch }
    }

    if (activeStep.type === 'action-setup') return { phase: 'action-setup', run }
    if (activeStep.type === 'first-frame' || activeStep.type === 'first-frame-candidate') {
      const batch = await service.resumeActionFirstFrameCandidates(run.id)
      return { phase: 'action-first-frame-candidates', ...batch }
    }
    if (activeStep.type === 'complete-animation') {
      return toActionSnapshot(await service.resumeAction(run.id), service)
    }
    if (activeStep.type === 'review') {
      const review = await service.getActionReview(run.id)
      return { phase: 'action-review', ...review }
    }
    throw new Error(`动作 WorkflowRun 无法恢复未知步骤：${activeStep.type}`)
  }

  async function confirmActionFirstFrame(
    input: ConfirmActionFirstFrameInput,
  ): Promise<ActionReviewResult> {
    // Service 先完成状态推进，再通过只读用例返回同一任务的审核帧。
    // Controller 不查询 Generation，也不把帧 URL 塞进 WorkflowRun Store。
    const run = await service.confirmActionFirstFrame(input)
    return service.getActionReview(run.id)
  }

  return {
    startCharacter: (input) => service.startCharacter(input),
    confirmCharacter: (input) => service.confirmCharacter(input),
    startAction: (input) => service.startAction(input),
    confirmActionFirstFrame,
    approveAction: (runId) => service.approveAction(runId),
    getWorkflow,
    listWorkflows,
    subscribe,
    subscribeAll,
    resume,
  }
}

function getActiveStep(run: WorkflowRun): WorkflowStep {
  const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
  if (!revision) throw new Error(`WorkflowRun ${run.id} 的 currentRevisionId 无效`)
  const active = revision.steps.find((step) => step.status === 'active')
  if (!active) throw new Error(`WorkflowRun ${run.id} 没有 active 步骤`)
  return active
}

async function toActionSnapshot(
  run: WorkflowRun,
  service: WorkflowRunService,
): Promise<WorkflowControllerSnapshot> {
  if (run.status !== 'active') return { phase: 'terminal', run }
  const active = getActiveStep(run)
  if (active.type === 'review') {
    const review = await service.getActionReview(run.id)
    return { phase: 'action-review', ...review }
  }
  throw new Error(`动画恢复后未进入审核：${active.type}`)
}
