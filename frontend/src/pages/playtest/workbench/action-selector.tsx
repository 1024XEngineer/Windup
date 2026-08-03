import { useId, useState } from 'react'

import type { PreviewAction } from './model/types'

export interface PlaytestAssetOption {
  key: string
  characterId: string
  outfitId: string
  name: string
  actionCount: number
}

export interface ActionSelectorProps {
  assets: readonly PlaytestAssetOption[]
  selectedAssetKey: string
  actions: readonly PreviewAction[]
  selectedActionId: string | null
  onSelectAsset(asset: PlaytestAssetOption): void
  onSelectAction(actionId: string): void
}

function frameCount(action: PreviewAction): number {
  return action.sequences.reduce((total, sequence) => total + sequence.frames.length, 0)
}

function assetDisplayName(asset: PlaytestAssetOption): string {
  const generatedSuffix = `（角色 ${asset.characterId}）`
  return asset.name.endsWith(generatedSuffix)
    ? asset.name.slice(0, -generatedSuffix.length)
    : asset.name
}

function AssetIdentity({
  asset,
  menuOpen = false,
  showCaret = false,
}: {
  asset: PlaytestAssetOption | null
  menuOpen?: boolean
  showCaret?: boolean
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="grid h-8 w-8 place-items-center rounded bg-[#dce9df] font-mono text-[10px] font-bold text-[#294331]"
      >
        {asset?.characterId.slice(-3) ?? '—'}
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-xs font-semibold text-white">
          {asset === null ? '没有可预览角色' : assetDisplayName(asset)}
        </strong>
        {asset !== null ? (
          <small className="mt-0.5 block truncate text-[9px] text-white/40">
            角色 {asset.characterId} · {asset.actionCount} 个动作
          </small>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={`text-center text-xs text-white/45 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
      >
        {showCaret ? '⌄' : ''}
      </span>
    </>
  )
}

export function ActionSelector({
  assets,
  selectedAssetKey,
  actions,
  selectedActionId,
  onSelectAsset,
  onSelectAction,
}: ActionSelectorProps) {
  const [assetMenuOpen, setAssetMenuOpen] = useState(false)
  const assetMenuId = useId()
  const selectedAsset =
    assets.find((candidate) => candidate.key === selectedAssetKey) ?? assets[0] ?? null
  const canSwitchAsset = assets.length > 1

  return (
    <div aria-label="动作列表" className="flex h-full min-h-0 flex-col bg-[#202522] p-3 text-white">
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setAssetMenuOpen(false)
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
          <span className="text-[9px] font-semibold text-white/40">
            {canSwitchAsset ? '角色 / 造型' : '当前角色'}
          </span>
          {canSwitchAsset ? (
            <span className="font-mono text-[8px] text-white/30">{assets.length} ITEMS</span>
          ) : null}
        </div>
        {canSwitchAsset ? (
          <button
            type="button"
            role="combobox"
            aria-label="同项目资产"
            aria-expanded={assetMenuOpen}
            aria-controls={assetMenuId}
            aria-haspopup="listbox"
            onClick={() => setAssetMenuOpen((open) => !open)}
            className="grid min-h-14 w-full grid-cols-[32px_minmax(0,1fr)_18px] items-center gap-2 rounded-md border border-white/10 bg-white/6 px-2 text-left outline-none transition-colors hover:border-white/20 hover:bg-white/9 focus-visible:border-[#a7c5ae]"
          >
            <AssetIdentity asset={selectedAsset} menuOpen={assetMenuOpen} showCaret />
          </button>
        ) : (
          <div
            aria-label="当前角色"
            className="grid min-h-14 w-full grid-cols-[32px_minmax(0,1fr)_18px] items-center gap-2 rounded-md border border-white/8 bg-white/4 px-2 text-left"
          >
            <AssetIdentity asset={selectedAsset} />
          </div>
        )}
        {canSwitchAsset && assetMenuOpen ? (
          <div
            id={assetMenuId}
            role="listbox"
            aria-label="可切换角色"
            className="absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-y-auto rounded-md border border-[#cbd2cc] bg-white p-1 text-[#253029] shadow-[0_12px_28px_rgba(10,20,13,0.2)]"
          >
            {assets.map((asset) => {
              const selected = asset.key === selectedAssetKey

              return (
                <button
                  key={asset.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setAssetMenuOpen(false)
                    if (!selected) onSelectAsset(asset)
                  }}
                  className={`grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 text-left ${
                    selected ? 'bg-[#e1ebe3] text-[#294331]' : 'hover:bg-[#f0f3f0]'
                  }`}
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-[11px]">
                      {assetDisplayName(asset)}
                    </strong>
                    <small className="mt-0.5 block truncate text-[9px] text-[#707971]">
                      角色 {asset.characterId}
                    </small>
                  </span>
                  <span className="font-mono text-[9px] text-[#69736b]">
                    {asset.actionCount} ACT
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      <div className="my-3 border-t border-white/8" />
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[9px] font-semibold text-white/40">动作</p>
        <span className="font-mono text-[8px] text-white/30">{actions.length} TOTAL</span>
      </div>
      <div className="mt-2 flex min-h-0 gap-1.5 overflow-x-auto pb-1 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
        {actions.map((action) => {
          const count = frameCount(action)
          const selected = action.id === selectedActionId

          return (
            <button
              key={action.id}
              type="button"
              aria-pressed={selected}
              disabled={count === 0}
              onClick={() => onSelectAction(action.id)}
              className={`grid min-h-12 w-36 shrink-0 grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors lg:w-full ${
                selected
                  ? 'border-white/12 bg-white/9 text-white'
                  : 'border-transparent text-white/60 hover:bg-white/5 hover:text-white'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <span
                aria-hidden="true"
                className={`h-5 w-1 rounded-sm ${selected ? 'bg-[#a7c5ae]' : 'bg-transparent'}`}
              />
              <span className="min-w-0">
                <strong className="block truncate text-xs">{action.name}</strong>
                <span
                  className={`mt-0.5 block text-[8px] uppercase ${selected ? 'text-[#a7c5ae]' : 'text-white/35'}`}
                >
                  {action.fps} FPS
                </span>
              </span>
              <span
                className={`text-[9px] tabular-nums ${selected ? 'text-white/75' : 'text-white/40'}`}
              >
                {count} 帧
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
