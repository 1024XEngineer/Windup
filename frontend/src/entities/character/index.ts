import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'
import type { ActionTemplate } from '../action-template'
import type { Action, Character, CharacterVariant, CreateCharacterInput } from './types'

/** 角色、动作、帧。后端接口未提供，下面的签名即我们提给后端的需求。 */

export type {
  Action,
  ActionKind,
  ActionStatus,
  Character,
  CharacterVariant,
  CreateCharacterInput,
  Frame,
  FrameQcResult,
} from './types'

/** 带全部动作与帧。审核台进入只需这一个调用。 */
export async function fetchCharacter(_id: string): Promise<Character> {
  throw new Error('not implemented：等待后端 GET /characters/{id}')
}

/** 资产库与项目详情页用。 */
export async function fetchCharactersByProject(_projectId: string): Promise<Character[]> {
  throw new Error('not implemented：等待后端 GET /projects/{id}/characters')
}

/** 建角色及第一套造型并生成候选母版。异步任务返回前候选列表可以为空。 */
export async function createCharacter(_input: CreateCharacterInput): Promise<Character> {
  throw new Error('not implemented：等待后端 POST /characters')
}

/** 确认某套造型的母版后才能为该造型添加动作。 */
export async function confirmCharacterTemplate(_variantId: string): Promise<CharacterVariant> {
  throw new Error('not implemented：等待后端角色造型母版确认接口')
}

/**
 * 加动作的入参。
 *
 * 写成可辨识联合而不是「kind 加一个可选 id」，是因为后者允许 kind: 'preset' 却不给
 * actionTemplateId——声明用了预设，却说不出用的是哪一份。那种组合没有意义，
 * 这里让它在类型上就不成立。
 *
 * TODO(待定)：自定义动作的提示词从哪来还没定。一种走法是自定义动作也先落成一份
 * project 作用域的 ActionTemplate，那样这里只剩模板 id，kind 可以取消。
 */
export type AddActionInput =
  | {
      /** 面向用户展示的动作名称。 */
      name: string
      /** 来自系统内置或项目自定义的动作模板。 */
      kind: 'preset'
      /** 选用的动作模板；预设动作必须指明。 */
      actionTemplateId: ActionTemplate['id']
    }
  | {
      /** 面向用户展示的动作名称。 */
      name: string
      /** 用户临时描述的动作，不走模板。 */
      kind: 'custom'
    }

/** 加一个动作，此时还未生成。 */
export async function addAction(_variantId: string, _input: AddActionInput): Promise<Action> {
  throw new Error('not implemented：等待后端角色造型动作接口')
}

/** 候选转正式。新候选不覆盖正式资产。 */
export async function confirmAction(_actionId: string): Promise<Action> {
  throw new Error('not implemented：等待后端 POST /actions/{id}/confirm')
}

/** 订阅一个角色。 */
export function useCharacter(id: string): AsyncState<Character> {
  return useAsync(() => fetchCharacter(id), [id])
}

/** 订阅项目下的角色列表。 */
export function useCharacters(projectId: string): AsyncState<Character[]> {
  return useAsync(() => fetchCharactersByProject(projectId), [projectId])
}
