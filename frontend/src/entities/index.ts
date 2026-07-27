/**
 * 模块一：数据层。本模块唯一对外入口，外部不得 import 内部文件。
 *
 * 这份清单是前后端契约的落点，但目前只有一部分算「已确认」：
 *
 * - 【已对接】Project —— 字段与路径对照后端 PR #57 的真实实现。
 * - 【提案·待双方 review】Character / WorkflowRun / ActionTemplate / Wearable ——
 *   后端接口尚未提供，签名是前端按界面需要拟的，等同于向后端提的需求；
 *   未经前后端一起走查前不得当作已定契约。阻断项见 frontend/README.md
 *   「给后端的问题清单」，代码里对应 TODO(对后端)。
 */

/* 项目 —— 已对接后端 PR #57 */
export {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  SPRITE_SIZES,
  createProject,
  deleteProject,
  fetchProject,
  fetchProjects,
  uploadImage,
  useProject,
  useProjects,
} from './project'
export type { CreateProjectInput, Project } from './project'

/* 角色 / 动作 / 帧 —— 提案，待与后端 review */
export {
  addAction,
  confirmAction,
  confirmTemplate,
  createCharacter,
  fetchCharacter,
  fetchCharactersByProject,
  useCharacter,
  useCharacters,
} from './character'
export type {
  Action,
  ActionKind,
  ActionStatus,
  Character,
  CreateCharacterInput,
  Frame,
  FrameQcResult,
} from './character'

/* 工作流数据 —— 提案，待与后端 review */
export {
  availableCommands,
  createWorkflowRun,
  currentStep,
  fetchWorkflowRun,
  locateFrame,
  subscribeTask,
  submitWorkflowStep,
  suggestNextCommand,
  useWorkflowRun,
  workflowRunKeys,
} from './workflow-run'
export type {
  CreateWorkflowRunInput,
  WorkflowCommand,
  WorkflowCommandKind,
  WorkflowDriver,
  WorkflowLocation,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowStepType,
} from './workflow-run'

/* 资产库 —— 提案，待与后端 review */
export { fetchActionTemplates, useActionTemplates } from './action-template'
export type { ActionTemplate } from './action-template'
export { fetchWearables, useWearables } from './wearable'
export type { Wearable } from './wearable'
