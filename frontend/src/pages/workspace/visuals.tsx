import assetLibraryArtwork from '@/assets/workspace/asset-library.png'
import playtestArtwork from '@/assets/workspace/playtest.png'
import quickStartArtwork from '@/assets/workspace/quick-start.png'
import workflowArtwork from '@/assets/workspace/workflow.png'

type WorkspaceVisualKind = 'asset' | 'playtest' | 'quick-start' | 'workflow'

interface WorkspaceEntranceVisualProps {
  kind: WorkspaceVisualKind
  selected?: boolean
}

/**
 * 四张像素画只提供入口氛围；入口名称和选中状态仍由卡片正文表达。
 */
export function WorkspaceEntranceVisual({ kind, selected = false }: WorkspaceEntranceVisualProps) {
  const artwork = {
    asset: assetLibraryArtwork,
    playtest: playtestArtwork,
    'quick-start': quickStartArtwork,
    workflow: workflowArtwork,
  }[kind]

  return (
    <div className="workspace-artwork-stage h-full w-full" data-selected={selected}>
      <img
        src={artwork}
        alt=""
        aria-hidden="true"
        draggable="false"
        className="workspace-artwork-image h-full w-full object-contain"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  )
}
