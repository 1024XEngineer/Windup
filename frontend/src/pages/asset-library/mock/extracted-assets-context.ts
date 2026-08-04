import { createContext, useContext } from 'react'

import type { Action } from '@/entities'

export type ExtractedAssetKind = 'action'

export interface ExtractedAsset {
  id: string
  kind: ExtractedAssetKind
  name: string
  source: string
  previewImageUrl: string
  /** 动作模板保留来源动作定义，复用时才能沿用真实帧率、帧和业务类型。 */
  sourceAction: Action
}

export interface ExtractedAssetsValue {
  assets: ExtractedAsset[]
  add: (asset: Omit<ExtractedAsset, 'id'>) => void
}

export const ExtractedAssetsContext = createContext<ExtractedAssetsValue | null>(null)

export function useExtractedAssets() {
  const value = useContext(ExtractedAssetsContext)
  if (!value) throw new Error('useExtractedAssets must be used within ExtractedAssetsProvider')
  return value
}
