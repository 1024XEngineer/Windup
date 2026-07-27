/** 查询缓存键。同一个 runId 只能对应同一份 WorkflowRun 查询键。 */
export const workflowRunKeys = {
  all: ['workflow-run'] as const,
  detail: (runId: string) => ['workflow-run', runId] as const,
  revision: (runId: string, revisionId: string) =>
    ['workflow-run', runId, 'revision', revisionId] as const,
}
