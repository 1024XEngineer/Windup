import { request } from '@/shared/api'
import type { CreateWorkflowRunInput, WorkflowRun } from '../model/types'
import { toWorkflowRun, type WorkflowRunDto } from './dto'

/** POST /workflows */
export async function createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
  const dto = await request<WorkflowRunDto>('/workflows', {
    method: 'POST',
    body: {
      project_id: input.projectId,
      driver: input.driver,
      prompt: input.prompt?.trim() || null,
    },
  })
  if (!dto) throw new Error('创建工作流未返回数据')
  return toWorkflowRun(dto)
}
