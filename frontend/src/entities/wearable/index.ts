import { useAsync } from '@/shared/hooks'
import type { AsyncState } from '@/shared/hooks'

/** 可复用的穿戴资产，与 action-template 同属项目资产库，先占好入口。 */

export interface Wearable {
  /** 穿戴资产 ID；具体生成方和格式等待 Wearable OpenAPI 确定。 */
  id: string
  /** 穿戴资产所属的 Project ID；是否支持系统内置资产仍待后端契约确定。 */
  projectId: string
  /** 面向用户展示的穿戴资产名称。 */
  name: string
  /** 穿戴资产预览图 URL；没有可展示预览时为 null。 */
  previewImageUrl: string | null
}

export async function fetchWearables(_projectId: string): Promise<Wearable[]> {
  throw new Error('not implemented：等待后端 GET /projects/{id}/wearables')
}

/** 订阅穿戴资产列表。 */
export function useWearables(projectId: string): AsyncState<Wearable[]> {
  return useAsync(() => fetchWearables(projectId), [projectId])
}
