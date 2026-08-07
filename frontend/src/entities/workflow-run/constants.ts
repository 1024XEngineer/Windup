/** WorkflowRun 使用的稳定业务词汇。 */

/** 后端资源状态只表达是否被软删除，不等同于前端节点状态。 */
export const WORKFLOW_RUN_STORAGE_STATUSES = ['active', 'soft_deleted'] as const

/** WorkflowNode 与 Workflow Editor 中用户看到的卡片一一对应。 */
export const WORKFLOW_NODE_TYPES = ['character', 'action'] as const
export const WORKFLOW_NODE_STATUSES = ['locked', 'active', 'passed', 'failed'] as const

/** phase 描述节点内部状态，不把“生成”和“选择”拆成额外节点。 */
export const WORKFLOW_NODE_PHASES = [
  'configuring_character',
  'generating_character_candidates',
  'selecting_character',
  'configuring_action',
  'generating_action_candidates',
  'selecting_action_frame',
  'generating_animation',
  'reviewing_animation',
  'completed',
] as const

export const WORKFLOW_GENERATION_ROLES = [
  'character_candidates',
  'action_frame_candidates',
  'animation',
] as const
