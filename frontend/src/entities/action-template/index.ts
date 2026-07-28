import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'

/** 可复用的动作模板；查询项目可用模板时合并系统内置与项目自定义数据。 */

interface ActionTemplateBase {
  /** 动作模板 ID；具体生成方和格式等待 ActionTemplate OpenAPI 确定。 */
  id: string
  /** 面向用户展示的模板名称，如“行走”或“待机”。 */
  name: string
  /** 模板预览图 URL，通常取第一帧；没有可展示预览时为 null。 */
  previewImageUrl: string | null
  /** 模板预期生成的总帧数，由后端给出，前端不写死。 */
  frameCount: number
  /** 模板建议播放帧率，单位为帧/秒。 */
  fps: number
}

/**
 * 项目可用的动作模板。
 * 系统内置模板没有项目归属；项目自定义模板必须携带所属 Project ID。
 */
export type ActionTemplate = ActionTemplateBase &
  (
    | {
        /** 系统内置模板，对所有项目可见。 */
        scope: 'system'
        /** 系统模板不属于任何项目，固定为 null。 */
        projectId: null
      }
    | {
        /** 由某个项目创建和维护的自定义模板。 */
        scope: 'project'
        /** 自定义模板所属的 Project ID。 */
        projectId: string
      }
  )

export async function fetchActionTemplates(_projectId: string): Promise<ActionTemplate[]> {
  throw new Error('not implemented：等待后端 GET /projects/{id}/action-templates')
}

/** 订阅系统内置模板与当前项目自定义模板的合集。 */
export function useActionTemplates(projectId: string): AsyncState<ActionTemplate[]> {
  return useAsync(() => fetchActionTemplates(projectId), [projectId])
}
