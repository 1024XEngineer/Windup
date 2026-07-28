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

/** 建角色及第一套造型并生成母版。异步任务返回时造型的 baseImageUrl 可能仍为 null。 */
export async function createCharacter(_input: CreateCharacterInput): Promise<Character> {
  throw new Error('not implemented：等待后端 POST /characters')
}

/** 确认某套造型的母版后才能为该造型添加动作。 */
export async function confirmBaseImage(_variantId: string): Promise<CharacterVariant> {
  throw new Error('not implemented：等待后端角色造型母版确认接口')
}

/** 加一个动作，此时还未生成。 */
export async function addAction(
  _variantId: string,
  _input: { name: string; kind: 'preset' | 'custom'; templateId?: string },
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
