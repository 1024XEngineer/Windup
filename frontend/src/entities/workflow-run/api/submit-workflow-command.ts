import { request } from '@/shared/api'
import type { WorkflowCommand, WorkflowRun } from '../model/types'
import { toCommandDto, toWorkflowRun, type WorkflowRunDto } from './dto'

/** POST /workflows/{id}/commands —— 校验与状态推进都在服务端，这里只发命令。 */
export async function submitWorkflowCommand(
  runId: string,
  command: WorkflowCommand,
): Promise<WorkflowRun> {
  const dto = await request<WorkflowRunDto>(`/workflows/${runId}/commands`, {
    method: 'POST',
    body: toCommandDto(command),
  })
  if (!dto) throw new Error(`工作流 ${runId} 命令未返回数据`)
  return toWorkflowRun(dto)
}
