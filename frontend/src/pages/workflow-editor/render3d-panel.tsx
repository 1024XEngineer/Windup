/**
 * 造型级 3D 资产的建 / 审 / 弃（Refs #518）。
 *
 * 三条约束：金额只从后端 `cost` 读（档位会变，前端抄一份就会分叉）；`awaiting_review`
 * 是人工闸，不提供任何自动放行路径；`error` 直接展示后端文案，不在前端重拼。
 */
import { useEffect, useState } from 'react'

import {
  RENDER3D_MOTION_CREDITS,
  RENDER3D_MOTION_LABELS,
  type CharacterStance,
  type MasterPrecheckReport,
  type Render3DApis,
  type Render3DAsset,
} from '@/entities'
import { KineticCopyCycle } from '@/shared/ui'

const PANEL_BUTTON =
  'inline-flex w-full items-center justify-center rounded-lg border border-transparent bg-app-accent px-3 py-2 text-[11px] font-medium text-app-on-accent transition-colors hover:bg-app-accent-strong disabled:cursor-not-allowed disabled:opacity-50'
const PANEL_BUTTON_SECONDARY =
  'inline-flex w-full items-center justify-center rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised px-3 py-2 text-[11px] font-medium text-[var(--color-app-ink)] transition-colors hover:border-app-accent disabled:cursor-not-allowed disabled:opacity-50'
const PANEL_SUMMARY = 'm-0 text-[11px] font-medium leading-[1.6] text-[var(--color-app-ink)]'
const PANEL_TEXT = 'm-0 text-[11px] leading-[1.6] text-[var(--color-app-muted)]'

/** 只有这两个状态在动，需要轮询；其余是稳态，停下来别空转。 */
const IN_FLIGHT = new Set<Render3DAsset['state']>(['building', 'rigging'])
const POLL_MS = 4000

/**
 * 建模 40~60 秒、绑骨再一段，中间后端只给状态不给百分比。
 * 一句不动的「正在绑骨…」在这个时长上读起来像卡死了，所以复用产品里已有的轮播文案
 * 表示它还活着。**这不是进度条** —— 没有真实百分比就不假装有。
 */
const BUILDING_COPY = [
  { lines: ['正在把母版立成 3D'] },
  { lines: ['估算体积与朝向'] },
  { lines: ['生成网格与贴图'] },
] as const

const RIGGING_COPY = [
  { lines: ['正在给模型绑骨'] },
  { lines: ['识别四肢与躯干'] },
  { lines: ['蒙皮权重收敛中'] },
] as const

const STATE_TEXT: Record<Render3DAsset['state'], string> = {
  absent: '尚未建 3D 资产',
  building: '正在生成 3D 模型…',
  awaiting_review: '模型已出，等你确认',
  rigging: '正在绑骨…',
  ready: '3D 资产已就绪',
  failed: '建 3D 资产失败',
}

/** 让用户声明体型。三个取值与后端 ``CharacterStance`` 一一对应。 */
const STANCE_CHOICES: ReadonlyArray<{ value: CharacterStance; label: string; hint?: string }> = [
  { value: 'biped', label: '双足人形', hint: '两条腿站立、一对上肢' },
  { value: 'quadruped', label: '四足', hint: '暂不支持绑骨' },
  { value: 'serpentine', label: '无肢 / 蛇形', hint: '暂不支持绑骨' },
]

type AssetState =
  | { status: 'loading' }
  | { status: 'done'; asset: Render3DAsset }
  | { status: 'error'; message: string }

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function useRender3DAsset(
  render3d: Render3DApis,
  characterId: string,
  outfitId: string,
  refreshKey: number,
): AssetState {
  const [state, setState] = useState<AssetState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      void render3d
        .getOutfitAsset(characterId, outfitId)
        .then((asset) => {
          if (cancelled) return
          setState({ status: 'done', asset })
          if (IN_FLIGHT.has(asset.state)) timer = setTimeout(tick, POLL_MS)
        })
        .catch((cause: unknown) => {
          if (!cancelled)
            setState({ status: 'error', message: message(cause, '读取 3D 资产状态失败') })
        })
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [characterId, outfitId, refreshKey, render3d])

  return state
}

export interface Render3DAssetPanelProps {
  render3d: Render3DApis
  characterId: string
  outfitId: string
  /** 母版预检结果。不过检就不给建 —— 重出母版比重建模型便宜一个量级。 */
  precheck: MasterPrecheckReport | null
  disabled: boolean
}

export function Render3DAssetPanel({
  render3d,
  characterId,
  outfitId,
  precheck,
  disabled,
}: Render3DAssetPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [stance, setStance] = useState<CharacterStance>('biped')
  const state = useRender3DAsset(render3d, characterId, outfitId, refreshKey)

  if (state.status === 'loading') {
    return (
      <p className={PANEL_SUMMARY} role="status">
        正在读取 3D 资产状态…
      </p>
    )
  }
  if (state.status === 'error') return <p className={PANEL_TEXT}>{state.message}</p>

  const { asset } = state
  const run = (work: () => Promise<Render3DAsset>) => {
    setBusy(true)
    setActionError(null)
    void work()
      .then(() => {
        setConfirming(false)
        setRefreshKey((key) => key + 1)
      })
      .catch((cause: unknown) => setActionError(message(cause, '操作失败')))
      .finally(() => setBusy(false))
  }

  const blocked = precheck !== null && !precheck.accepted
  const locked = disabled || busy
  const cost = asset.cost

  return (
    <div className="grid gap-2" role="group" aria-label="3D 资产">
      {asset.state === 'building' || asset.state === 'rigging' ? (
        <KineticCopyCycle
          messages={asset.state === 'building' ? BUILDING_COPY : RIGGING_COPY}
          ariaLabel={STATE_TEXT[asset.state]}
          className={PANEL_SUMMARY}
        />
      ) : (
        <p className={PANEL_SUMMARY} role="status">
          {STATE_TEXT[asset.state]}
        </p>
      )}
      {asset.error ? <p className={PANEL_TEXT}>{asset.error}</p> : null}
      {actionError ? <p className={PANEL_TEXT}>{actionError}</p> : null}

      {asset.state === 'absent' && !confirming ? (
        <>
          <button
            type="button"
            className={PANEL_BUTTON}
            aria-label="建 3D 资产"
            disabled={locked || blocked}
            onClick={() => setConfirming(true)}
          >
            建 3D 资产 · {cost.totalCredits} 积分
          </button>
          {blocked && precheck ? <p className={PANEL_TEXT}>{precheck.detail}</p> : null}
        </>
      ) : null}

      {asset.state === 'absent' && confirming ? (
        <div className="grid gap-2" role="group" aria-label="确认建 3D 资产">
          <p className={PANEL_TEXT}>
            将扣 {cost.totalCredits} 积分（图生 3D {cost.model3dCredits} + 绑骨{' '}
            {cost.autorigCredits}）。
            {cost.scope === 'per_outfit_once' ? '同一造型只收一次，后续动作不再计费。' : null}
            每个账号最多同时持有 2 个 3D 角色，弃掉一个就能再建。
          </p>
          <fieldset className="grid gap-1.5 border-0 p-0">
            {/* 体型必须由用户声明：四足与人形的包围盒比例完全重叠，几何上判不出来，
                而自动绑骨对非双足不报错，只会漏认被遮挡的肢体。 */}
            <legend className={PANEL_TEXT}>这个角色是——</legend>
            {STANCE_CHOICES.map(({ value, label, hint }) => (
              <label key={value} className="flex items-start gap-2 text-[11px] leading-[1.5]">
                <input
                  type="radio"
                  name={`stance-${outfitId}`}
                  value={value}
                  checked={stance === value}
                  disabled={busy}
                  onChange={() => setStance(value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-[var(--color-app-ink)]">{label}</span>
                  {hint ? <span className="text-[var(--color-app-muted)]">　{hint}</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={PANEL_BUTTON_SECONDARY}
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              type="button"
              className={PANEL_BUTTON}
              aria-label="确认扣费并建 3D 资产"
              disabled={busy || stance !== 'biped'}
              onClick={() => run(() => render3d.buildOutfitAsset(characterId, outfitId, stance))}
            >
              确认扣费
            </button>
          </div>
          {stance !== 'biped' ? (
            <p className={PANEL_TEXT}>
              {STANCE_CHOICES.find((choice) => choice.value === stance)?.label}
              角色目前无法绑定骨骼，三渲二只支持双足人形。这一步没有扣费，可以改走视频路线。
            </p>
          ) : null}
        </div>
      ) : null}

      {asset.state === 'awaiting_review' ? (
        <div className="grid gap-2" role="group" aria-label="确认 3D 模型">
          {asset.reviewModelUrl ? (
            <a
              className={PANEL_BUTTON_SECONDARY}
              href={asset.reviewModelUrl}
              target="_blank"
              rel="noreferrer"
            >
              下载模型看一眼
            </a>
          ) : null}
          <p className={PANEL_TEXT}>
            模型生成即最终、改不动；不合格只能弃掉重建。放行会再扣 {cost.autorigCredits} 积分绑骨。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={PANEL_BUTTON_SECONDARY}
              aria-label="弃掉待审模型"
              disabled={locked}
              onClick={() => run(() => render3d.discardOutfitAsset(characterId, outfitId))}
            >
              弃掉重建
            </button>
            <button
              type="button"
              className={PANEL_BUTTON}
              aria-label="放行并开始绑骨"
              disabled={locked}
              onClick={() => run(() => render3d.approveOutfitAsset(characterId, outfitId))}
            >
              放行绑骨
            </button>
          </div>
        </div>
      ) : null}

      {asset.state === 'ready' ? (
        <div className="flex flex-col gap-2">
          <p className={PANEL_SUMMARY}>动作</p>
          <p className={PANEL_TEXT}>
            一份绑骨产物只带一个动作，所以每加一个动作要再绑一次骨（
            {RENDER3D_MOTION_CREDITS} 积分）。已经有的不会重复扣。
          </p>
          <div className="flex flex-wrap gap-2">
            {asset.bakeableMotions.map((motion) => {
              const done = asset.bakedMotions.includes(motion)
              return (
                <button
                  key={motion}
                  type="button"
                  className={done ? PANEL_BUTTON_SECONDARY : PANEL_BUTTON}
                  style={{ width: 'auto' }}
                  aria-label={
                    done
                      ? `${RENDER3D_MOTION_LABELS[motion]}已就绪`
                      : `烘入${RENDER3D_MOTION_LABELS[motion]}，${RENDER3D_MOTION_CREDITS} 积分`
                  }
                  disabled={locked || done}
                  onClick={() => run(() => render3d.addOutfitMotion(characterId, outfitId, motion))}
                >
                  {done
                    ? `${RENDER3D_MOTION_LABELS[motion]} 已就绪`
                    : `烘入${RENDER3D_MOTION_LABELS[motion]}（${RENDER3D_MOTION_CREDITS} 积分）`}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {asset.state === 'failed' ? (
        <button
          type="button"
          className={PANEL_BUTTON_SECONDARY}
          aria-label="清掉重来"
          disabled={locked}
          onClick={() => run(() => render3d.discardOutfitAsset(characterId, outfitId))}
        >
          清掉重来
        </button>
      ) : null}
    </div>
  )
}
