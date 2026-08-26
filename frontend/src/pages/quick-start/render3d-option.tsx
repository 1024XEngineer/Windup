/**
 * 角色确认之后的可选进阶路线：给这个造型建 3D 资产（Refs #518）。
 *
 * 默认折叠。Quick Start 的主线是「一句话跑完」，而建 3D 是按次计费、带人工确认闸、
 * 每账号还有名额上限的重动作 —— 摊开在主线上会把它读成必经的一步。
 */
import { useState } from 'react'

import { render3DApis } from '@/entities'
import { Render3DAssetPanel } from '@/pages/workflow-editor/render3d-panel'

/** 只取建资产要的那两个 id；不依赖整个会话，测试也就不必造一份完整会话。 */
export interface Render3DOptionSession {
  getCharacterInfo(): { characterId: string; outfitId: string } | null
}

export function Render3DOption({ session }: { session: Render3DOptionSession | null }) {
  const [open, setOpen] = useState(false)
  const info = session?.getCharacterInfo() ?? null
  if (!info) return null

  return (
    <div className="w-full max-w-2xl">
      {open ? (
        <div className="grid gap-2 rounded-2xl border border-app-line bg-app-surface-muted p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-xs font-semibold text-app-ink">3D 资产 · 三渲二</p>
            <button
              type="button"
              className="text-[11px] text-app-muted transition hover:text-app-ink"
              onClick={() => setOpen(false)}
            >
              收起
            </button>
          </div>
          <p className="m-0 text-[11px] leading-[1.6] text-app-muted">
            建好后这个角色的每个动作都能改用三渲二出帧：多朝向零额外费用、各朝向天生一致。
            目前只支持双足人形。
          </p>
          <Render3DAssetPanel
            render3d={render3DApis}
            characterId={info.characterId}
            outfitId={info.outfitId}
            precheck={null}
            disabled={false}
          />
        </div>
      ) : (
        <button
          type="button"
          className="rounded-xl border border-app-line bg-app-surface-muted px-3 py-2 text-xs font-semibold text-app-muted transition hover:border-app-accent hover:text-app-ink"
          onClick={() => setOpen(true)}
        >
          进阶 · 给这个角色建 3D 资产
        </button>
      )}
    </div>
  )
}
