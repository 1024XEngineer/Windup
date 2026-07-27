import { useAsync } from '@/shared/lib'
import type { AsyncState } from '@/shared/lib'
import type { Action, Character, CreateCharacterInput } from './types'

/** 角色、动作、帧。后端接口未提供，下面的签名即我们提给后端的需求。 */

export type {
  Action,
  ActionKind,
  ActionStatus,
  Character,
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

/** 建角色并生成母版。异步任务，返回时 templateImageUrl 可能仍为 null。 */
export async function createCharacter(_input: CreateCharacterInput): Promise<Character> {
  throw new Error('not implemented：等待后端 POST /characters')
}

/** 确认母版后才能加动作。 */
export async function confirmTemplate(_characterId: string): Promise<Character> {
  throw new Error('not implemented：等待后端 POST /characters/{id}/template/confirm')
}

/** 加一个动作，此时还未生成。 */
export async function addAction(
  _characterId: string,
  _input: { name: string; kind: 'preset' | 'custom'; templateId?: string },
): Promise<Action> {
  throw new Error('not implemented：等待后端 POST /characters/{id}/actions')
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
