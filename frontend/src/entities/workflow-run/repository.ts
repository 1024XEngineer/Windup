import { localWorkflowRunRepository } from './local/repository'
import type { WorkflowRunRepository } from './model/repository'

/** 当前实现的唯一选择点；真实契约冻结后只在这里替换或组合 Adapter。 */
export const workflowRunRepository: WorkflowRunRepository = localWorkflowRunRepository
