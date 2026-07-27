import { useNavigate, useParams } from 'react-router'

import { PageHeader } from '@/shared/ui'
import { InspectionPreview } from './inspection-preview'

/**
 * 检查/预览台的路由适配器。
 *
 * 只读 characterId、渲染页头和执行跨页跳转；播放与检查交互属于
 * ./inspection-preview 模块。
 */
export function PlaytestPage() {
  const navigate = useNavigate()
  const { characterId: rawCharacterId } = useParams()
  const characterId = Number(rawCharacterId)

  return (
    <>
      <PageHeader title="试玩" subtitle={`角色 ${rawCharacterId ?? '（无）'}`} onBack={() => navigate(-1)} />
      {Number.isInteger(characterId) && characterId > 0 ? (
        <InspectionPreview
          characterId={characterId}
          onOpenWorkflowAtFrame={(location) => {
            navigate(
              `/workflow-editor/${location.runId}?stepId=${location.stepId}` +
                `&actionId=${location.actionId}&frameIndex=${location.frameIndex}`,
            )
          }}
        />
      ) : (
        <p className="text-sm text-red-500">无效的角色 ID。</p>
      )}
    </>
  )
}
