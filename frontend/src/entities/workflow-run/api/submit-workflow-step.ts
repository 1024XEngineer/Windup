import type { WorkflowCommand, WorkflowRun } from '../model/types'
import { loadRun, saveRun } from './local-store'

/**
 * 提交一步的结果并推进状态。
 *
 * 后端暂时不存 workflow，所以推进由前端完成：把这一步标成 done，把下一个待办步骤
 * 设为当前步；没有待办了就整条完成。以后后端接管时改成
 * POST /workflows/{id}/steps/{stepId}，由服务端返回推进后的数据。保持调用方稳定是目标，
 * 最终签名仍需前后端共同 Review。
 */
export async function submitWorkflowStep(
  runId: string,
  stepId: string,
  _command: WorkflowCommand,
): Promise<WorkflowRun> {
  const run = loadRun(runId)
  if (!run) throw new Error(`工作流 ${runId} 不存在`)

  const steps = run.steps.map((step) =>
    step.id === stepId ? { ...step, status: 'done' as const } : step,
  )
  const next = steps.find((step) => step.status === 'pending')

  return saveRun({
    ...run,
    steps,
    currentStepId: next?.id ?? null,
    status: next ? run.status : 'completed',
  })
}
