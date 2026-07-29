import { useParams } from 'react-router'

import { CharacterSetup } from '@/features/character-setup'
import { PageHeader } from '@/shared/ui'

/**
 * “资产库”是前端聚合页面名称，不代表后端存在统一 Asset 资源。
 * 系统内置动作模板作为当前项目可用资源一并展示。
 * 按角色/视角/动作浏览，「继续补充动作」复用 CharacterSetup。
 */
export function AssetLibraryPage() {
  const { projectId = '' } = useParams()

  return (
    <>
      <PageHeader title="资产库" subtitle={`项目 ${projectId} 内可复用的角色与动作`} />
      <p className="mb-4 text-sm text-slate-400">
        待实现：读取当前项目的 Character、ActionTemplate，以及系统内置 ActionTemplate。
      </p>
      <CharacterSetup projectId={projectId} />
    </>
  )
}
