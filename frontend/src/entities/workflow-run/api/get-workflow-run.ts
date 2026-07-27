import type { WorkflowRun } from '../model/types'
import { loadRun } from './local-store'

/**
 * 按 id 取回一次运行，刷新页面与从审核台跳回时靠它恢复现场。
 *
 * 后端暂不存 workflow。未来改成 GET /workflows/{id} 时以保持调用方稳定为目标，
 * 最终签名仍需前后端共同 Review。
 */
export async function fetchWorkflowRun(runId: string): Promise<WorkflowRun> {
  const run = loadRun(runId)
  if (!run) throw new Error(`工作流 ${runId} 不存在`)
  return run
}
