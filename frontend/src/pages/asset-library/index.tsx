import { useSearchParams } from 'react-router'

import { CharacterSetup } from '@/features/character-setup'
import { PageHeader } from '@/shared/ui'

/**
 * 资产库是项目下属的，不是全站总库，所以必须带 projectId 进来。
 * 按角色/视角/动作浏览，「继续补充动作」复用 CharacterSetup。
 */
export function AssetLibraryPage() {
  const [search] = useSearchParams()
  const projectId = search.get('projectId') ?? ''

  if (!projectId) {
    return (
      <>
        <PageHeader title="资产库" />
        <p className="text-sm text-slate-500">
          资产库属于某个项目，请先从项目页进入（/asset-library?projectId=…）。
        </p>
      </>
    )
  }

  return (
    <>
      <PageHeader title="资产库" subtitle={`项目 ${projectId} 内可复用的角色、动作与穿戴`} />
      <p className="mb-4 text-sm text-slate-400">
        待实现：读 Character / ActionTemplate / Wearable 三个列表并筛选。
      </p>
      <CharacterSetup projectId={projectId} />
    </>
  )
}
