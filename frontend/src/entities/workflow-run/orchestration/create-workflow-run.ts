import { localWorkflowRunRepository } from '../local/repository'
import type { CreateWorkflowRunInput, WorkflowRun } from '../model/types'

/** 创建前端编排状态；真实后端能力由后续独立 Adapter 接入。 */
export async function createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
  return localWorkflowRunRepository.create(input)
}
