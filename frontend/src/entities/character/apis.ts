/**
 * Character 聚合资源对应的服务端接口集合。
 *
 * Character、Outfit、Action 作为一棵聚合数据更新，避免前端为尚未冻结的细粒度
 * 路由提前创建多层抽象。这里只声明调用形状，不提供实现。
 */
import type {
  AddActionInput,
  Character,
  ConfirmCharacterTemplateInput,
  CreateCharacterInput,
} from './types'

/** Character 聚合数据对应的服务端 API；更新粒度以后端合同为准。 */
export interface CharacterAPIs {
  /** 读取包含 Outfit 与 Action 的完整 Character。 */
  get(characterId: Character['id']): Promise<Character>
  /** 按 Project 归属列出角色。 */
  listByProject(projectId: Character['projectId']): Promise<Character[]>
  /** 创建角色基础资料；母版和动作由后续流程补充。 */
  create(input: CreateCharacterInput): Promise<Character>
  /** 按后端约定提交完整 Character 聚合更新。 */
  update(character: Character): Promise<Character>
  /** 确认某个 Outfit 的角色母版候选。 */
  confirmCharacterTemplate(
    characterId: Character['id'],
    input: ConfirmCharacterTemplateInput,
  ): Promise<Character>
  /** 基于动作模板或自定义提示词，为指定 Outfit 增加动作。 */
  addAction(characterId: Character['id'], input: AddActionInput): Promise<Character>
}
