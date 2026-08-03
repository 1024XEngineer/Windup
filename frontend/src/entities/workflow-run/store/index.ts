/**
 * WorkflowRun 本地仓库的子目录入口。
 *
 * 本目录回答“WorkflowRun 在当前前端怎样创建、校验、保存和通知”。
 * 它依赖 model，但 model 不反向依赖 Store。后续接入服务器持久化时，
 * 可替换这层的适配实现，不需改变 WorkflowRun 领域类型。
 */

export {
  createWorkflowRunStore,
  WORKFLOW_RUN_STORAGE_KEY,
  WORKFLOW_RUN_STORAGE_VERSION,
} from './workflow-run-store'
export type { CreateWorkflowRunStoreOptions, WorkflowRunStore } from './workflow-run-store'
