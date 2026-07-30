interface ActionTemplateBase {
  id: string
  name: string
  prompt: string
}

/** 系统内置模板没有项目归属；项目自定义模板必须携带所属 Project ID。 */
export type ActionTemplate = ActionTemplateBase &
  ({ scope: 'system'; projectId: null } | { scope: 'project'; projectId: string })

/** ActionTemplate 对应的一组后端接口。 */
export interface ActionTemplateApis {
  listAvailable(projectId: string): Promise<ActionTemplate[]>
}
