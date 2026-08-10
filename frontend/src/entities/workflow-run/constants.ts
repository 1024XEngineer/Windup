/** WorkflowRun 使用的稳定业务词汇。 */

/** 后端资源状态只表达是否被软删除，不等同于前端节点状态。 */
export const WORKFLOW_RUN_STORAGE_STATUSES = ['active', 'soft_deleted'] as const

/** WorkflowNode 与 Workflow Editor 中用户看到的六类卡片一一对应。 */
export const WORKFLOW_NODE_TYPES = [
  'character-setup',
  'character-template',
  'action-first-frame',
  'action-generation-method',
  'action-full-frame',
  'review',
] as const
export const WORKFLOW_NODE_STATUSES = ['locked', 'active', 'passed', 'failed'] as const

/** phase 只描述一张卡片内部的进度；节点之间的先后关系由显式边表达。 */
export const WORKFLOW_NODE_PHASES = [
  'configuring',
  'ready',
  'generating',
  'selecting',
  'reviewing',
  'completed',
] as const

/** 与 Generation.type 使用同一组词，避免恢复任务时再做第二套名称转换。 */
export const WORKFLOW_GENERATION_ROLES = [
  'character_template',
  'first_frame',
  'complete_animation',
] as const
