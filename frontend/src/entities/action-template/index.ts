import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'

/** 可复用的动作模板；查询项目可用模板时合并系统内置与项目自定义数据。 */

interface ActionTemplateBase {
  id: string
  name: string
  /** 通常取第一帧。 */
  previewImageUrl: string | null
  /** 由后端给出，前端不写死。 */
  frameCount: number
  fps: number
}

export type ActionTemplate = ActionTemplateBase &
  ({ scope: 'system'; projectId: null } | { scope: 'project'; projectId: string })

export async function fetchActionTemplates(_projectId: string): Promise<ActionTemplate[]> {
  throw new Error('not implemented：等待后端 GET /projects/{id}/action-templates')
}

/** 订阅系统内置模板与当前项目自定义模板的合集。 */
export function useActionTemplates(projectId: string): AsyncState<ActionTemplate[]> {
  return useAsync(() => fetchActionTemplates(projectId), [projectId])
}
