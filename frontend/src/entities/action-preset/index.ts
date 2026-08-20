import type { ActionType } from '../character'

/**
 * 菜单里的预设动作。文案的唯一真相源在后端（`windup_ai_engine.prompt.presets`）：
 * `description` 会随请求进到图片与视频两条生成通路，必须先过后端的措辞门禁，
 * 前端不再留副本。`label` 只用于展示，`name` 才是落进 WorkflowRun 的动作名。
 */
export interface ActionPreset {
  type: ActionType
  label: string
  name: string
  description: string
}

export interface ActionPresetApis {
  list(signal?: AbortSignal): Promise<ActionPreset[]>
}
