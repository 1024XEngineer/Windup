import type { ActionTemplate } from '../action-template'
import type { ActionType, Character, CreateCharacterInput } from './types'

export type {
  Action,
  ActionKind,
  ActionType,
  ActionStatus,
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

/**
 * 将动作定义应用到角色时，同时提交来源方式和业务语义。
 * kind 与最终 Action.kind 含义一致；type 与最终 Action.type 含义一致。
 * 两者相互独立，不能从 preset/custom 推断 walk/idle 等业务语义。
 */
export type AddActionInput =
  | {
      /** 面向用户展示的动作名称。 */
      name: string
      /** 复用已有预设定义的来源方式。 */
      kind: 'preset'
      /** 动作实际表达的业务语义；不由 preset 自动推断。 */
      type: ActionType
      /** 本次复用的动作模板；preset 分支必须明确指定。 */
      actionTemplateId: ActionTemplate['id']
    }
  | {
      /** 面向用户展示的动作名称。 */
      name: string
      /** 用户自行定义动作的来源方式。 */
      kind: 'custom'
      /** 动作实际表达的业务语义；custom 来源仍可选择 walk、attack 等已知语义。 */
      type: ActionType
    }

/**
 * Character 的异步存取契约。造型、动作和帧是 Character 内的完整 JSON 树，
 * 不通过独立后端粒度方法写入；每次确认后整棵更新。
 */
/** 只读角色查询边界；Playtest 等核验模块只依赖这一部分。 */
export interface CharacterReader {
  get(id: Character['id']): Promise<Character>
  listByProject(projectId: string): Promise<Character[]>
}

export interface CharacterRepository extends CharacterReader {
  create(input: CreateCharacterInput): Promise<Character>
  update(character: Character): Promise<Character>
}
