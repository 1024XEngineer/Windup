interface ActionTemplateBase {
  id: string
  name: string
  prompt: string
}

/** 系统内置模板没有项目归属；项目自定义模板必须携带所属 Project ID。 */
export type ActionTemplate = ActionTemplateBase &
  (
    | {
        scope: 'system'
        projectId: null
      }
    | {
        scope: 'project'
        projectId: string
      }
  )

/** 动作模板查询契约；当前没有实现或 React 查询 Hook。 */
export interface ActionTemplateRepository {
  listAvailable(projectId: string): Promise<ActionTemplate[]>
}
