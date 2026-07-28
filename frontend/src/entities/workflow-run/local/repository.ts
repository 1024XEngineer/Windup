import type { WorkflowRunRepository } from '../model/repository'
import { advanceLocalRun, createLocalRun } from './machine'
import { loadRun } from './store'

export const localWorkflowRunRepository: WorkflowRunRepository = {
  async create(input) {
    return createLocalRun(input)
  },
  async get(runId) {
    return loadRun(runId)
  },
  async submit(runId, command) {
    return advanceLocalRun(runId, command)
  },
}
