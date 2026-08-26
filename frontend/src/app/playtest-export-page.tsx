import { createProgressiveExportModel, ExportButton } from '@/features/export-package'
import { PlaytestPage, type PlaytestPageProps } from '@/pages/playtest'

const renderToolbar: NonNullable<PlaytestPageProps['renderToolbar']> = ({
  project,
  character,
  outfitId,
  initialActionId,
}) => {
  const outfit = character.outfits.find((candidate) => candidate.id === outfitId)
  if (!outfit?.actions.some((action) => action.frames.length > 0)) return null
  try {
    const model = createProgressiveExportModel({
      project,
      character,
      outfitId,
      playtest: { initialActionId },
    })
    return (
      <ExportButton
        model={model}
        className="border-[#294433] bg-[#294433] text-white hover:bg-[#203828]"
      />
    )
  } catch {
    // 旧资产可以继续试玩；缺少母版时只隐藏无法满足契约的导出入口。
    return null
  }
}

export function PlaytestExportPage() {
  return <PlaytestPage renderToolbar={renderToolbar} />
}
