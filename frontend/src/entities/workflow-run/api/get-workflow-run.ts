import { request } from '@/shared/api'
import type { WorkflowRun } from '../model/types'
import { toWorkflowRun, type WorkflowRunDto } from './dto'

/** GET /workflows/{id}，不存在时抛 ApiError(404)。 */
export async function fetchWorkflowRun(runId: string): Promise<WorkflowRun> {
  const dto = await request<WorkflowRunDto>(`/workflows/${runId}`)
  if (!dto) throw new Error(`工作流 ${runId} 返回为空`)
  return toWorkflowRun(dto)
}
