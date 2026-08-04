import { useId, useState, type FormEvent } from 'react'

import type { PreviewAction } from './model/types'

export interface PlaytestAssetOption {
  key: string
  characterId: string
  outfitId: string
  name: string
  /** 后端真实造型名；展示名可能由动作名补足，但改名必须编辑这个字段。 */
  outfitName?: string
  previewUrl?: string | null
  actionCount: number
}

export interface ActionSelectorProps {
  assets: readonly PlaytestAssetOption[]
  selectedAssetKey: string
  actions: readonly PreviewAction[]
  selectedActionId: string | null
  onSelectAsset(asset: PlaytestAssetOption): void
  onSelectAction(actionId: string): void
  onAddAction?(): void
  onRenameAsset?(asset: PlaytestAssetOption, name: string): Promise<void>
  onDeleteAsset?(asset: PlaytestAssetOption): Promise<void>
  onRenameAction?(actionId: string, name: string): Promise<void>
  onDeleteAction?(actionId: string): Promise<void>
}

interface ManagementTarget {
  kind: 'asset' | 'action'
  id: string
  label: string
  value: string
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

function AssetThumbnail({
  asset,
  compact = false,
}: {
  asset: PlaytestAssetOption
  compact?: boolean
}) {
  const sizeClass = compact ? 'h-8 w-8' : 'h-9 w-9'
  if (asset.previewUrl) {
    return (
      <img
        src={asset.previewUrl}
        alt=""
        className={`${sizeClass} shrink-0 rounded bg-[#dce9df] object-contain [image-rendering:pixelated]`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`grid ${sizeClass} shrink-0 place-items-center rounded bg-[#dce9df] font-mono text-[10px] font-bold text-[#294331]`}
    >
      {asset.characterId.slice(-3)}
    </span>
  )
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
      {asset ? (
        <AssetThumbnail asset={asset} compact />
      ) : (
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded bg-[#dce9df] text-[#294331]"
        >
          —
        </span>
      )}
      <span className="min-w-0">
        <strong
          className="block truncate text-xs font-semibold text-white"
          title={asset ? assetDisplayName(asset) : undefined}
        >
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
  onAddAction,
  onRenameAsset,
  onDeleteAsset,
  onRenameAction,
  onDeleteAction,
}: ActionSelectorProps) {
  const [assetMenuOpen, setAssetMenuOpen] = useState(false)
  const assetMenuId = useId()
  const selectedAsset =
    assets.find((candidate) => candidate.key === selectedAssetKey) ?? assets[0] ?? null
  const canSwitchAsset = assets.length > 1
  const [renameTarget, setRenameTarget] = useState<ManagementTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ManagementTarget | null>(null)
  const [operationBusy, setOperationBusy] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = renameTarget
    const name = target?.value.trim() ?? ''
    if (!target || !name || !selectedAsset) return

    setOperationBusy(true)
    setOperationError(null)
    try {
      if (target.kind === 'asset') await onRenameAsset?.(selectedAsset, name)
      else await onRenameAction?.(target.id, name)
      setRenameTarget(null)
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '改名失败')
    } finally {
      setOperationBusy(false)
    }
  }

  async function confirmDelete() {
    const target = deleteTarget
    if (!target || !selectedAsset) return

    setOperationBusy(true)
    setOperationError(null)
    try {
      if (target.kind === 'asset') await onDeleteAsset?.(selectedAsset)
      else await onDeleteAction?.(target.id)
      setDeleteTarget(null)
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : '删除失败')
    } finally {
      setOperationBusy(false)
    }
  }

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
            aria-label="全部 Playtest 资产"
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
                  className={`grid min-h-14 w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2 rounded px-2 text-left ${
                    selected ? 'bg-[#e1ebe3] text-[#294331]' : 'hover:bg-[#f0f3f0]'
                  }`}
                >
                  <AssetThumbnail asset={asset} />
                  <span className="min-w-0">
                    <strong className="block truncate text-[11px]" title={assetDisplayName(asset)}>
                      {assetDisplayName(asset)}
                    </strong>
                    <small className="mt-0.5 block truncate text-[9px] text-[#707971]">
                      {asset.outfitName ?? '造型'} · 角色 {asset.characterId}
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
        {selectedAsset && (onRenameAsset || onDeleteAsset) ? (
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {onRenameAsset ? (
              <button
                type="button"
                aria-label={`重命名资产 ${assetDisplayName(selectedAsset)}`}
                title="重命名当前角色造型"
                onClick={() => {
                  setDeleteTarget(null)
                  setRenameTarget({
                    kind: 'asset',
                    id: selectedAsset.key,
                    label: '资产名称',
                    value: selectedAsset.outfitName ?? assetDisplayName(selectedAsset),
                  })
                }}
                className="min-h-8 rounded border border-white/10 text-[10px] font-semibold text-white/65 hover:bg-white/8 hover:text-white"
              >
                改名
              </button>
            ) : null}
            {onDeleteAsset ? (
              <button
                type="button"
                aria-label={`删除资产 ${assetDisplayName(selectedAsset)}`}
                title="删除当前角色造型及其动作"
                onClick={() => {
                  setRenameTarget(null)
                  setDeleteTarget({
                    kind: 'asset',
                    id: selectedAsset.key,
                    label: '资产',
                    value: assetDisplayName(selectedAsset),
                  })
                }}
                className="min-h-8 rounded border border-[#68413d] text-[10px] font-semibold text-[#e0aaa3] hover:bg-[#5a302c] hover:text-white"
              >
                删除
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {renameTarget ? (
        <form
          onSubmit={(event) => void submitRename(event)}
          className="mt-2 rounded border border-white/10 bg-white/5 p-2"
        >
          <label className="grid gap-1 text-[9px] text-white/55">
            {renameTarget.label}
            <input
              aria-label={renameTarget.label}
              value={renameTarget.value}
              disabled={operationBusy}
              onChange={(event) =>
                setRenameTarget((current) =>
                  current ? { ...current, value: event.target.value } : current,
                )
              }
              className="min-h-8 rounded border border-white/15 bg-[#171b18] px-2 text-[11px] text-white outline-none focus:border-[#a7c5ae]"
            />
          </label>
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              disabled={operationBusy}
              onClick={() => setRenameTarget(null)}
              className="min-h-7 px-2 text-[9px] text-white/55"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={operationBusy || !renameTarget.value.trim()}
              className="min-h-7 rounded bg-[#a7c5ae] px-2 text-[9px] font-semibold text-[#1d2b21] disabled:opacity-40"
            >
              {operationBusy ? '保存中' : '保存'}
            </button>
          </div>
        </form>
      ) : null}
      {deleteTarget ? (
        <div
          role="alertdialog"
          aria-label={`确认删除${deleteTarget.label}`}
          className="mt-2 rounded border border-[#70423d] bg-[#3d2522] p-2"
        >
          <p className="text-[10px] leading-4 text-[#f0c2bc]">
            确认删除“{deleteTarget.value}”？此操作会写入后端。
          </p>
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              disabled={operationBusy}
              onClick={() => setDeleteTarget(null)}
              className="min-h-7 px-2 text-[9px] text-white/60"
            >
              取消
            </button>
            <button
              type="button"
              disabled={operationBusy}
              onClick={() => void confirmDelete()}
              className="min-h-7 rounded bg-[#a94b42] px-2 text-[9px] font-semibold text-white disabled:opacity-40"
            >
              {operationBusy ? '删除中' : '确认删除'}
            </button>
          </div>
        </div>
      ) : null}
      {operationError ? (
        <p role="alert" className="mt-2 text-[9px] leading-4 text-[#f0aaa2]">
          {operationError}
        </p>
      ) : null}
      <div className="my-3 border-t border-white/8" />
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[9px] font-semibold text-white/40">动作</p>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[8px] text-white/30">{actions.length} TOTAL</span>
          {onAddAction ? (
            <button
              type="button"
              aria-label="添加动作"
              title="给当前角色添加动作"
              onClick={onAddAction}
              className="grid h-7 w-7 place-items-center rounded border border-white/12 text-base text-[#b7d0bd] hover:border-white/25 hover:bg-white/8 hover:text-white"
            >
              +
            </button>
          ) : null}
        </span>
      </div>
      <div className="mt-2 flex min-h-0 gap-1.5 overflow-x-auto pb-1 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
        {actions.map((action) => {
          const count = frameCount(action)
          const selected = action.id === selectedActionId

          return (
            <div key={action.id} className="flex w-44 shrink-0 items-stretch gap-1 lg:w-full">
              <button
                type="button"
                aria-pressed={selected}
                disabled={count === 0}
                onClick={() => onSelectAction(action.id)}
                className={`grid min-h-12 min-w-0 flex-1 grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
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
              {onRenameAction || onDeleteAction ? (
                <span className="grid w-7 shrink-0 grid-rows-2 gap-1">
                  {onRenameAction ? (
                    <button
                      type="button"
                      aria-label={`重命名动作 ${action.name}`}
                      title="重命名动作"
                      onClick={() => {
                        setDeleteTarget(null)
                        setRenameTarget({
                          kind: 'action',
                          id: action.id,
                          label: '动作名称',
                          value: action.name,
                        })
                      }}
                      className="grid place-items-center rounded border border-white/10 text-xs text-white/55 hover:bg-white/8 hover:text-white"
                    >
                      ✎
                    </button>
                  ) : null}
                  {onDeleteAction ? (
                    <button
                      type="button"
                      aria-label={`删除动作 ${action.name}`}
                      title="删除动作"
                      onClick={() => {
                        setRenameTarget(null)
                        setDeleteTarget({
                          kind: 'action',
                          id: action.id,
                          label: '动作',
                          value: action.name,
                        })
                      }}
                      className="grid place-items-center rounded border border-[#68413d] text-xs text-[#e0aaa3] hover:bg-[#5a302c] hover:text-white"
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
