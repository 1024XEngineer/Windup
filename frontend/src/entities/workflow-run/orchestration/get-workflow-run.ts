import { localWorkflowRunRepository } from '../local/repository'
import type { WorkflowRun } from '../model/types'

/** 读取前端编排状态；WorkflowRun 不是后端资源。 */
export async function fetchWorkflowRun(runId: WorkflowRun['id']): Promise<WorkflowRun> {
  const run = localWorkflowRunRepository.get(runId)
  if (!run) throw new Error(`工作流 ${runId} 不存在`)
  return run
}
