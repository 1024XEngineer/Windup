import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'
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

/** 加一个动作，此时还未生成。 */
export async function addAction(
  _variantId: string,
  _input: {
    /** 面向用户展示的动作名称。 */
    name: string
    /** 动作来自系统预设还是用户自定义。 */
    kind: 'preset' | 'custom'
    /** 选用的 ActionTemplate ID；不使用动作模板时可以省略。 */
    actionTemplateId?: string
  },
): Promise<Action> {
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
