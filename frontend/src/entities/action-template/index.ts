/**
 * ActionTemplate 实体及其公开 APIs。
 *
 * ActionTemplate 表示“动作模板”，用于描述可复用的动作名称与生成提示词；它与
 * 角色母版 CharacterTemplate 完全不同。当前内容较少，因此遵循粗粒度原则集中在
 * 一个入口文件中，不为 types/apis 额外创建空目录层级。
 */
interface ActionTemplateBase {
  /** 动作模板的稳定业务标识。 */
  id: string
  /** 面向用户展示的动作名称，例如“行走”或“待机”。 */
  name: string
  /** 后端生成动作时使用的模板提示词。 */
  prompt: string
}

/** 系统内置动作模板没有 Project 归属。 */
export type ActionTemplate = ActionTemplateBase &
  ({ scope: 'system'; projectId: null } | { scope: 'project'; projectId: string })

/** 动作模板对应的服务端 API。 */
export interface ActionTemplateAPIs {
  /** 返回系统内置模板与指定项目自定义模板的可用集合。 */
  listAvailable(projectId: string): Promise<ActionTemplate[]>
}
