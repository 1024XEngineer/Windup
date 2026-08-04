interface ActionTemplateBase {
  id: string
  name: string
  prompt: string
  type: 'walk' | 'idle' | 'attack' | 'jump' | 'custom'
  fps: number
  frameCount: number
  loop: boolean
}

/** 系统内置模板没有项目归属；项目自定义模板必须携带所属 Project ID。 */
export type ActionTemplate = ActionTemplateBase &
  ({ scope: 'system'; projectId: null } | { scope: 'project'; projectId: string })

/**
 * WorkflowEditor 的「增加节点」通过此接口读取可选动作模板。
 * 当前资产库验证只负责保存与展示模板，不在角色详情中直接应用模板。
 */
export interface ActionTemplateApis {
  listAvailable(projectId: string): Promise<ActionTemplate[]>
}
