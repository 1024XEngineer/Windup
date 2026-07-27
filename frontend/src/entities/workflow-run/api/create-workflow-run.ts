import type { CreateWorkflowRunInput, WorkflowRun } from '../model/types'
import { initialSteps, newRunId, saveRun } from './local-store'

/**
 * 新建一次运行，两个入口都调它。
 *
 * 后端暂不存 workflow，先落本地。未来改成 POST /workflows 时以保持调用方稳定为目标，
 * 最终签名仍需前后端共同 Review。
 */
export async function createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
  const steps = initialSteps()
  return saveRun({
    id: newRunId(),
    projectId: input.projectId,
    characterId: null,
    driver: input.driver,
    status: 'running',
    currentStepId: steps[0].id,
    steps,
  })
}
