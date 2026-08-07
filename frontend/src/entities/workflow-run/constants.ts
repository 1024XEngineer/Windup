export const WORKFLOW_PURPOSES = ['create_character', 'add_action'] as const
export const WORKFLOW_RUN_STATUSES = ['active', 'interrupted', 'completed', 'failed'] as const
export const GENERATION_STATUSES = ['not_started', 'in_progress', 'completed', 'failed'] as const
export const EXPORT_STATUSES = ['not_exported', 'exporting', 'exported', 'failed'] as const
export const WORKFLOW_NODE_STATUSES = ['locked', 'available', 'active', 'passed', 'failed'] as const

/** 新建角色时的基础节点顺序；之后可并发追加 action-full-frame / review 成对节点。 */
export const WORKFLOW_NODE_ORDER = [
  'character-setup',
  'character-template',
  'action-first-frame',
  'action-full-frame',
  'review',
] as const
