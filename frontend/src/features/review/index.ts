import type { WorkflowRun } from '@/entities'

/** 工作流审核的用户决定。Playtest 中的逐帧检查不使用这套写操作。 */
export type ReviewDecision =
  | { kind: 'approve' }
  | { kind: 'request_changes'; restartStepId: string }

export interface ReviewSubmission {
  runId: WorkflowRun['id']
  decision: ReviewDecision
}

interface ReviewController {
  approveReview(runId: WorkflowRun['id']): WorkflowRun
  restart(runId: WorkflowRun['id'], stepId: string): WorkflowRun
}

/** 把审核决定交给唯一的 WorkflowController 执行，不在 Review Feature 中复制状态机。 */
export function submitReview(
  controller: ReviewController,
  { runId, decision }: ReviewSubmission,
): WorkflowRun {
  return decision.kind === 'approve'
    ? controller.approveReview(runId)
    : controller.restart(runId, decision.restartStepId)
}
