import type { WorkflowRunRepository } from '../model/repository'
import { advanceLocalRun, createLocalRun } from './machine'
import { loadRun } from './store'

export const localWorkflowRunRepository: WorkflowRunRepository = {
  create: createLocalRun,
  get: loadRun,
  submit: advanceLocalRun,
}
