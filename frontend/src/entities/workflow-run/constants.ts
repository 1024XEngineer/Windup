export const WORKFLOW_DRIVERS = ['ai', 'manual'] as const
export const WORKFLOW_PURPOSES = ['create_character', 'add_action'] as const
export const WORKFLOW_RUN_STATUSES = ['active', 'interrupted', 'completed', 'failed'] as const
export const WORKFLOW_REVISION_STATUSES = ['active', 'completed', 'failed', 'abandoned'] as const
export const GENERATION_STATUSES = ['not_started', 'in_progress', 'completed', 'failed'] as const
export const EXPORT_STATUSES = ['not_exported', 'exporting', 'exported', 'failed'] as const
export const WORKFLOW_STEP_STATUSES = ['locked', 'available', 'active', 'passed', 'failed'] as const

/** 当前产品工作流的固定八步，也是存储校验与进度 UI 的唯一顺序来源。 */
export const WORKFLOW_STEP_ORDER = [
  'character-setup',
  'character-template',
  'template-candidate',
  'action-setup',
  'first-frame',
  'complete-animation',
  'review',
  'export',
] as const
