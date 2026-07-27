import { useAsync } from '@/shared/lib'
import type { AsyncState } from '@/shared/lib'

/** 可复用的穿戴资产，与 action-template 同属项目资产库，先占好入口。 */

export interface Wearable {
  id: string
  projectId: string
  name: string
  previewImageUrl: string | null
}

export async function fetchWearables(_projectId: string): Promise<Wearable[]> {
  throw new Error('not implemented：等待后端 GET /projects/{id}/wearables')
}

/** 订阅穿戴资产列表。 */
export function useWearables(projectId: string): AsyncState<Wearable[]> {
  return useAsync(() => fetchWearables(projectId), [projectId])
}
