import { useMemo, useState, type ReactNode } from 'react'

import {
  ExtractedAssetsContext,
  type ExtractedAsset,
  type ExtractedAssetsValue,
} from './extracted-assets-context'

/** 层级验证专用的内存态：模拟提取成功后，派生资产分类即时出现在项目资产库。 */
export function ExtractedAssetsProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<ExtractedAsset[]>([])
  const value = useMemo<ExtractedAssetsValue>(
    () => ({
      assets,
      add(asset) {
        setAssets((current) => [
          ...current,
          { ...asset, id: `extracted-${asset.kind}-${current.length + 1}` },
        ])
      },
    }),
    [assets],
  )

  return <ExtractedAssetsContext.Provider value={value}>{children}</ExtractedAssetsContext.Provider>
}
