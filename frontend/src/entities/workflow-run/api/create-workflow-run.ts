import type { CreateWorkflowRunInput, WorkflowRun } from '../model/types'
import { initialRevision, newId, saveRun } from './local-store'

/** 创建运行。未来 Python adapter 必须保持相同领域返回值。 */
export async function createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
  const prompt = input.prompt?.trim() || null
  const revision = initialRevision({ driver: input.driver, prompt })
  return saveRun({
    id: newId('run'),
    projectId: input.projectId,
    characterId: null,
    driver: input.driver,
    status: 'active',
    currentRevisionId: revision.id,
    revisions: [revision],
    prompt,
  })
}
