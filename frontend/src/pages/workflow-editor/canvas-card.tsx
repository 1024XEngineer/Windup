import { useState } from 'react'

import {
  CANDIDATES,
  PRESET_ACTIONS,
  plusOptions,
  type ActionSpec,
  type Card,
} from '@/features/canvas-flow'
import { FrameArrivalStrip, VisualOptionPicker } from '@/shared/ui'
import { PlusMenu } from './plus-menu'

const EYEBROW: Record<Card['kind'], string> = {
  origin: '01 · SOURCE',
  candidates: '02 · GENERATE',
  master: '03 · IDENTITY',
  'first-frame': '04 · KEYFRAME',
  animation: '05 · SEQUENCE',
  review: '06 · REVIEW',
  export: '07 · DELIVERY',
}

const STATUS_LABEL: Record<Card['status'], string> = {
  idle: '待填写',
  running: '生成中',
  review: '待确认',
  confirmed: '已确认',
}

export interface CanvasCardProps {
  card: Card
  brief: string
  selectedCandidateId: string | null
  onBriefChange: (value: string) => void
  onActionChange: (patch: Partial<ActionSpec>) => void
  onSelectCandidate: (id: string) => void
  onGenerate: () => void
  onConfirm: () => void
  onPick: (optionId: string) => void
  onRemove: () => void
}

/** 画布上的一张卡片。种类决定正面放什么，状态决定给哪个动作。 */
export function CanvasCard(props: CanvasCardProps) {
  const { card } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const options = plusOptions(card)

  return (
    <article className={`canvas-card canvas-card--${card.kind}`} data-status={card.status}>
      <header className="canvas-card__head">
        <span className="canvas-card__eyebrow">{EYEBROW[card.kind]}</span>
        <h2>{titleOf(card)}</h2>
        <span className="canvas-card__status">{STATUS_LABEL[card.status]}</span>
      </header>

      <div className="canvas-card__body">{renderBody(props, advanced, setAdvanced)}</div>

      {/* 只有用户自己从加号挂上去的卡片能删；候选、母版、审核是系统接上的，删了会让图断掉。 */}
      {card.kind === 'first-frame' || card.kind === 'export' ? (
        <button type="button" className="canvas-card__remove" onClick={props.onRemove}>
          {card.kind === 'export' ? '删除这张卡片' : '删除这条分支'}
        </button>
      ) : null}

      {options.length > 0 ? (
        <div className="canvas-card__plus-wrap">
          <button
            type="button"
            className="canvas-card__plus"
            aria-label="添加下一步"
            onClick={() => {
              // 只有一个合法下游时不弹菜单，直接生成那张卡片。
              if (options.length === 1 && !options[0].children) {
                props.onPick(options[0].id)
                return
              }
              setMenuOpen((open) => !open)
            }}
          >
            ＋
          </button>
          {menuOpen ? (
            <PlusMenu options={options} onPick={props.onPick} onClose={() => setMenuOpen(false)} />
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function titleOf(card: Card): string {
  switch (card.kind) {
    case 'origin':
      return '角色起点'
    case 'candidates':
      return '母版候选'
    case 'master':
      return '身份母版'
    case 'first-frame':
      return `${actionLabel(card)} · 首帧`
    case 'animation':
      return `${actionLabel(card)} · 完整动画`
    case 'review':
      return `${actionLabel(card)} · 审核`
    case 'export':
      return '导出资源包'
  }
}

function actionLabel(card: Card): string {
  if (!card.action) return '动作'
  return card.action.name.trim() || '未命名动作'
}

function renderBody(
  props: CanvasCardProps,
  advanced: boolean,
  setAdvanced: (next: boolean) => void,
) {
  const { card } = props

  if (card.kind === 'origin') {
    return (
      <>
        <label className="canvas-field">
          <span>角色描述</span>
          <textarea
            rows={4}
            value={props.brief}
            placeholder="描述身份、服装、体型与识别特征"
            onChange={(event) => props.onBriefChange(event.target.value)}
            disabled={card.status === 'confirmed'}
          />
        </label>
        {card.status === 'confirmed' ? (
          <p className="canvas-note">已提交，母版候选在下游生成。</p>
        ) : (
          <button
            type="button"
            className="canvas-action"
            disabled={props.brief.trim().length === 0}
            onClick={props.onGenerate}
          >
            提交并生成母版候选
          </button>
        )}
      </>
    )
  }

  if (card.kind === 'candidates') {
    if (card.status === 'idle') return <p className="canvas-note">等待上游提交角色描述。</p>
    return (
      <>
        <VisualOptionPicker
          label="母版候选"
          selectedId={props.selectedCandidateId}
          options={CANDIDATES.filter((_, index) => index < card.images.length).map((item) => ({
            id: item.id,
            label: item.label,
            imageUrl: item.imageUrl,
          }))}
          onSelect={props.onSelectCandidate}
        />
        <p className="canvas-note">
          已到达 {card.images.length} / {card.total || CANDIDATES.length}
        </p>
        {card.status === 'review' ? (
          <button
            type="button"
            className="canvas-action"
            disabled={!props.selectedCandidateId}
            onClick={props.onConfirm}
          >
            确认所选母版
          </button>
        ) : null}
      </>
    )
  }

  if (card.kind === 'master') {
    const chosen = CANDIDATES.find((item) => item.id === props.selectedCandidateId)
    return (
      <>
        <figure className="canvas-master">
          {chosen ? <img src={chosen.imageUrl} alt="已确认的身份母版" /> : null}
          <figcaption>母版已锁定，后续每个动作都以它为约束</figcaption>
        </figure>
        <p className="canvas-note">用右下角的加号选择下一步。</p>
      </>
    )
  }

  if (card.kind === 'first-frame' && card.action) {
    return (
      <>
        {card.action.kind === 'custom' ? (
          <label className="canvas-field">
            <span>动作名称</span>
            <input
              value={card.action.name}
              placeholder="例如：拔刀居合"
              onChange={(event) => props.onActionChange({ name: event.target.value })}
              disabled={card.status !== 'idle'}
            />
          </label>
        ) : null}
        <label className="canvas-field">
          <span>动作描述</span>
          <textarea
            rows={3}
            value={card.action.brief}
            placeholder={placeholderOf(card.action)}
            onChange={(event) => props.onActionChange({ brief: event.target.value })}
            disabled={card.status !== 'idle'}
          />
        </label>
        {card.images.length > 0 ? (
          <figure className="canvas-keyframe">
            <img src={card.images[0]} alt="生成的首帧" />
          </figure>
        ) : null}
        {card.status === 'idle' ? (
          <button
            type="button"
            className="canvas-action"
            disabled={!readyToGenerate(card.action)}
            onClick={props.onGenerate}
          >
            生成首帧
          </button>
        ) : null}
        {card.status === 'review' ? (
          <button type="button" className="canvas-action" onClick={props.onConfirm}>
            确认首帧
          </button>
        ) : null}
      </>
    )
  }

  if (card.kind === 'animation' && card.action) {
    const spec = card.action
    return (
      <>
        <FrameArrivalStrip
          label={`${actionLabel(card)} 帧序列`}
          eyebrow={`SIDE · ${spec.fps} FPS`}
          frames={Array.from({ length: spec.frameCount }, (_, index) => ({
            id: `frame-${index}`,
            imageUrl: card.images[index],
          }))}
        />
        <button type="button" className="canvas-toggle" onClick={() => setAdvanced(!advanced)}>
          高级{advanced ? ' ▴' : ' ▾'}
          {spec.frameCountOverridden ? <em className="canvas-override">已覆盖默认值</em> : null}
        </button>
        {advanced ? (
          <label className="canvas-field canvas-field--inline">
            <span>帧数</span>
            <select
              value={spec.frameCount}
              disabled={card.status !== 'idle'}
              onChange={(event) =>
                props.onActionChange({
                  frameCount: Number(event.target.value),
                  frameCountOverridden: Number(event.target.value) !== 36,
                })
              }
            >
              {[8, 16, 24, 36].map((count) => (
                <option key={count} value={count}>
                  {count} 帧
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {card.status === 'idle' ? (
          <button type="button" className="canvas-action" onClick={props.onGenerate}>
            生成完整动画
          </button>
        ) : null}
        {card.status === 'review' ? (
          <button type="button" className="canvas-action" onClick={props.onConfirm}>
            确认动画
          </button>
        ) : null}
      </>
    )
  }

  if (card.kind === 'review') {
    return (
      <>
        <p className="canvas-note">帧已到齐，逐帧检查后通过。</p>
        {card.status !== 'confirmed' ? (
          <button type="button" className="canvas-action" onClick={props.onConfirm}>
            全部通过
          </button>
        ) : (
          <p className="canvas-note">已通过，可进入导出。</p>
        )}
      </>
    )
  }

  if (card.kind === 'export') {
    return (
      <>
        <fieldset className="canvas-formats">
          <legend>导出格式</legend>
          {['Cocos plist', 'TexturePacker JSON', 'GIF 预览', '逐帧 PNG'].map((format) => (
            <label key={format}>
              <input type="checkbox" defaultChecked={format !== 'TexturePacker JSON'} />
              {format}
            </label>
          ))}
        </fieldset>
        {card.status === 'confirmed' ? (
          <p className="canvas-note">资源包已生成。</p>
        ) : (
          <button type="button" className="canvas-action" onClick={props.onGenerate}>
            出包
          </button>
        )}
      </>
    )
  }

  return null
}

function placeholderOf(spec: ActionSpec): string {
  const preset = PRESET_ACTIONS.find((item) => item.type === spec.type)
  return preset?.placeholder ?? '描述动作意图与关键姿态'
}

function readyToGenerate(spec: ActionSpec): boolean {
  if (spec.brief.trim().length === 0) return false
  if (spec.kind === 'custom' && spec.name.trim().length === 0) return false
  return true
}
