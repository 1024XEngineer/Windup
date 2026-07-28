import { localWorkflowRunRepository } from '../local/repository'
import type { WorkflowCommand, WorkflowRun } from '../model/types'

/** 推进前端页面编排；不把命令发送到不存在的 WorkflowRun 后端接口。 */
export async function submitWorkflowCommand(
  runId: WorkflowRun['id'],
  command: WorkflowCommand,
): Promise<WorkflowRun> {
  return localWorkflowRunRepository.submit(runId, command)
}
