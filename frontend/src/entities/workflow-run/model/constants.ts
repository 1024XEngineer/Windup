/**
 * WorkflowRun 的业务词汇和步骤模板。
 *
 * 常量数组同时服务于三个地方：TypeScript 联合类型、运行时水合校验、
 * 以及页面的进度顺序。只保留一份定义，可以避免“类型说可以，恢复时却拒绝”。
 */

/** 该 Run 是由 AI 自动引导，还是用户在编辑器中手动推进。 */
export const WORKFLOW_DRIVERS = ['ai', 'manual'] as const

/**
 * 一个 Run 只有一个目标。新建角色和追加动作可在同一界面连续操作，
 * 但是两次独立任务，因此使用两个 WorkflowRun。
 */
export const WORKFLOW_PURPOSES = ['create_character', 'add_action'] as const

/** Run 级状态：描述整个用户任务，不等于某次后端生成任务的状态。 */
export const WORKFLOW_RUN_STATUSES = ['active', 'interrupted', 'completed', 'failed'] as const

/**
 * Revision 级状态。用户从旧步骤重做时，旧 Revision 变为 abandoned，
 * 并追加新 Revision；不覆盖历史，才能说清“这个结果从哪次重做而来”。
 */
export const WORKFLOW_REVISION_STATUSES = ['active', 'completed', 'failed', 'abandoned'] as const

/** 当前 Revision 中生成阶段的汇总状态，不是单个 GenerationTask.status。 */
export const GENERATION_STATUSES = ['not_started', 'in_progress', 'completed', 'failed'] as const

/** 导出阶段的汇总状态；角色生成 Run 没有导出步骤时保持 not_exported。 */
export const EXPORT_STATUSES = ['not_exported', 'exporting', 'exported', 'failed'] as const

/**
 * 单个步骤的状态。locked 表示前置条件未满足，available 表示可开始，
 * active 表示当前正在处理，passed/failed 是已结束结果。
 */
export const WORKFLOW_STEP_STATUSES = ['locked', 'available', 'active', 'passed', 'failed'] as const

/** 角色形象每次生成 4 张临时候选；用户只会确认其中 1 张为正式资产。 */
export const CHARACTER_CANDIDATE_COUNT = 4

/** 动作也先生成 4 张独立首帧，避免错误姿势直接扩展成完整动画。 */
export const ACTION_FIRST_FRAME_CANDIDATE_COUNT = 4

/**
 * 按任务目的分开定义步骤顺序。
 *
 * create_character 到“四选一并保存正式角色”就结束；
 * add_action 从已有角色/造型开始，不重复跑角色母版生成。
 *
 * 两个 Run 可以由同一页面连续展示，但数据上必须拆开，否则历史记录、
 * 失败重试和后续追加动作都无法准确归属。
 */
export const WORKFLOW_STEP_ORDERS = {
  create_character: ['character-setup', 'character-template', 'template-candidate'],
  add_action: [
    'action-setup',
    'first-frame',
    'first-frame-candidate',
    'complete-animation',
    'review',
    'export',
  ],
} as const
