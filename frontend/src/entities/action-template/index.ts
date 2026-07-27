import { useAsync } from '@/shared/lib'
import type { AsyncState } from '@/shared/lib'

/**
 * 可复用的动作模板，项目下属而非全站总库。
 * 复用能力一期之后做，先占好数据入口。
 */

export interface ActionTemplate {
  id: string
  projectId: string
  name: string
  /** 通常取第一帧。 */
  previewImageUrl: string | null
  /** 由后端给出，前端不写死。 */
  frameCount: number
  hasDisplacement: boolean
}

export async function fetchActionTemplates(_projectId: string): Promise<ActionTemplate[]> {
  throw new Error('not implemented：等待后端 GET /projects/{id}/action-templates')
}

/** 订阅动作模板列表。 */
export function useActionTemplates(projectId: string): AsyncState<ActionTemplate[]> {
  return useAsync(() => fetchActionTemplates(projectId), [projectId])
}
