/**
 * Character 模块的唯一公共出口。
 *
 * 外部模块应从此文件导入 Character 相关类型与 APIs，而不是跨目录引用内部文件。
 * 这样后续调整文件布局时不会迫使所有调用方同步修改路径。
 */
export type { CharacterAPIs } from './apis'
export type {
  Action,
  ActionSource,
  ActionStatus,
  ActionType,
  AddActionInput,
  ActionSequence,
  BaseFrame,
  Character,
  CharacterTemplateCandidate,
  ConfirmCharacterTemplateInput,
  CreateCharacterInput,
  Frame,
  FrameQcResult,
  FrameRootMotion,
  Outfit,
} from './types'
