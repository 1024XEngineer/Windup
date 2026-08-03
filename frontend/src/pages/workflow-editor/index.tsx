import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  CARD_WIDTH,
  addCard,
  autoAppend,
  createGraph,
  descendants,
  findCard,
  layout,
  planFor,
  removeCard,
  runGeneration,
  updateCard,
  type ActionSpec,
  type CanvasGraph,
  type Card,
} from '@/features/canvas-flow'
import { CanvasCard } from './canvas-card'
import './canvas.css'

/** 项目级约束在创建项目时定，画布上只读展示，卡片里不再重复采集。 */
const PROJECT_CONSTRAINTS = ['侧视', '256 × 256', '低饱和像素风']

const MIN_SCALE = 0.3
const MAX_SCALE = 1.2

/**
 * 工作流编辑器画布。
 * 用户从起点卡片出发，点卡片右下角的加号选下一步，卡片由系统生成并连好；
 * 画布上没有绘制连线的入口。生成过程全部在前端 mock，不发请求。
 */
export function WorkflowEditorPage() {
  const [graph, setGraph] = useState<CanvasGraph>(createGraph)
  const [view, setView] = useState({ x: 80, y: 60, scale: 0.72 })
  const dragRef = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null)
  const cancelRef = useRef(new Map<string, () => void>())
  const viewportRef = useRef<HTMLDivElement>(null)

  /**
   * 用户拖动卡片产生的位移，叠加在系统排布之上。
   * 只改观感不改结构：连线仍由 parentId 推出来，拖到哪儿都不影响谁接谁。
   */
  const [offsets, setOffsets] = useState<Record<string, { dx: number; dy: number }>>({})
  const cardDragRef = useRef<{ id: number; cardId: string; x: number; y: number } | null>(null)

  const positions = useMemo(() => {
    const base = layout(graph)
    const placed: Record<string, { x: number; y: number }> = {}
    for (const [id, point] of Object.entries(base)) {
      const offset = offsets[id]
      placed[id] = offset ? { x: point.x + offset.dx, y: point.y + offset.dy } : point
    }
    return placed
  }, [graph, offsets])

  useEffect(() => {
    const cancels = cancelRef.current
    return () => {
      for (const cancel of cancels.values()) cancel()
      cancels.clear()
    }
  }, [])

  const patch = useCallback((id: string, next: Partial<Card>) => {
    setGraph((current) => updateCard(current, id, next))
  }, [])

  /** 启动一次假生成：产物逐张到达，到齐后转为待确认。 */
  const generate = useCallback(
    (card: Card) => {
      const plan = planFor(card)
      patch(card.id, { status: 'running', images: [], total: plan.total })
      const cancel = runGeneration(
        plan,
        (images) => patch(card.id, { images }),
        () => {
          cancelRef.current.delete(card.id)
          // 导出没有可确认的产物，出包即完成。
          patch(card.id, { status: card.kind === 'export' ? 'confirmed' : 'review' })
        },
      )
      cancelRef.current.set(card.id, cancel)
    },
    [patch],
  )

  const confirm = useCallback((card: Card) => {
    setGraph((current) => {
      let next = updateCard(current, card.id, { status: 'confirmed' })
      // 候选确认后自动接上母版，动画确认后自动接上审核——这两步不经加号。
      if (card.kind === 'candidates') next = autoAppend(next, card.id, 'master', 'confirmed')
      if (card.kind === 'animation') next = autoAppend(next, card.id, 'review')
      return next
    })
  }, [])

  const startOrigin = useCallback((card: Card) => {
    setGraph((current) =>
      autoAppend(updateCard(current, card.id, { status: 'confirmed' }), card.id, 'candidates'),
    )
  }, [])

  // 母版候选卡片一旦挂上就立即开跑，用户不用在它上面再点一次生成。
  useEffect(() => {
    const pending = graph.cards.find((card) => card.kind === 'candidates' && card.status === 'idle')
    if (pending) generate(pending)
  }, [graph.cards, generate])

  /** 拖卡片头部搬动卡片；位移要除以缩放倍率，否则缩小时卡片跑得比光标快。 */
  const onCardPointerDown = (event: React.PointerEvent, cardId: string) => {
    if (!(event.target as HTMLElement).closest('.canvas-card__head')) return
    event.stopPropagation()
    cardDragRef.current = { id: event.pointerId, cardId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onCardPointerMove = (event: React.PointerEvent) => {
    const drag = cardDragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const dx = (event.clientX - drag.x) / view.scale
    const dy = (event.clientY - drag.y) / view.scale
    cardDragRef.current = { ...drag, x: event.clientX, y: event.clientY }
    setOffsets((current) => {
      const previous = current[drag.cardId] ?? { dx: 0, dy: 0 }
      return { ...current, [drag.cardId]: { dx: previous.dx + dx, dy: previous.dy + dy } }
    })
  }

  const onCardPointerUp = (event: React.PointerEvent) => {
    if (cardDragRef.current?.id !== event.pointerId) return
    cardDragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('.canvas-card')) return
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ox: view.x,
      oy: view.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    setView((current) => ({
      ...current,
      x: drag.ox + event.clientX - drag.x,
      y: drag.oy + event.clientY - drag.y,
    }))
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (dragRef.current?.id !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const zoom = (delta: number) =>
    setView((current) => ({
      ...current,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale + delta)),
    }))

  /**
   * 滚轮缩放与双指平移。
   * 走原生监听而非 onWheel，因为 React 的合成事件是被动的，preventDefault 不生效，
   * 缩放时页面会跟着滚。缩放锚在光标位置，不是画布原点，否则放大后目标会跑出视口。
   */
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = viewport.getBoundingClientRect()
      const px = event.clientX - bounds.left
      const py = event.clientY - bounds.top
      setView((current) => {
        if (!event.ctrlKey && !event.metaKey) {
          return { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }
        }
        const scale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, current.scale * (1 - event.deltaY * 0.01)),
        )
        return {
          scale,
          x: px - ((px - current.x) / current.scale) * scale,
          y: py - ((py - current.y) / current.scale) * scale,
        }
      })
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className="canvas-page">
      <header className="canvas-bar">
        <div className="canvas-bar__left">
          <b>工作流编辑器</b>
          <span>从起点出发，用卡片右下角的加号选下一步</span>
        </div>
        <ul className="canvas-constraints" aria-label="项目级约束">
          {PROJECT_CONSTRAINTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="canvas-bar__right">
          <button type="button" onClick={() => zoom(-0.12)} aria-label="缩小">
            −
          </button>
          <span>{Math.round(view.scale * 100)}%</span>
          <button type="button" onClick={() => zoom(0.12)} aria-label="放大">
            ＋
          </button>
          <button
            type="button"
            onClick={() => {
              setGraph(createGraph())
              setOffsets({})
            }}
          >
            重置
          </button>
        </div>
      </header>

      <div
        ref={viewportRef}
        className="canvas-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="canvas-world"
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
        >
          <Wires graph={graph} positions={positions} />
          {graph.cards.map((card) => {
            const position = positions[card.id]
            return (
              <div
                key={card.id}
                className="canvas-slot"
                style={{ left: position.x, top: position.y, width: CARD_WIDTH[card.kind] }}
                onPointerDown={(event) => onCardPointerDown(event, card.id)}
                onPointerMove={onCardPointerMove}
                onPointerUp={onCardPointerUp}
                onPointerCancel={onCardPointerUp}
              >
                <CanvasCard
                  card={card}
                  brief={graph.characterBrief}
                  selectedCandidateId={graph.selectedCandidateId}
                  onBriefChange={(value) =>
                    setGraph((current) => ({ ...current, characterBrief: value }))
                  }
                  onActionChange={(next: Partial<ActionSpec>) =>
                    setGraph((current) => {
                      const target = findCard(current, card.id)
                      if (!target?.action) return current
                      return updateCard(current, card.id, { action: { ...target.action, ...next } })
                    })
                  }
                  onSelectCandidate={(id) =>
                    setGraph((current) => ({ ...current, selectedCandidateId: id }))
                  }
                  onGenerate={() => (card.kind === 'origin' ? startOrigin(card) : generate(card))}
                  onConfirm={() => confirm(card)}
                  onPick={(optionId) => setGraph((current) => addCard(current, card.id, optionId))}
                  onRemove={() => {
                    const doomed = descendants(graph, card.id)
                    if (
                      doomed.length > 1 &&
                      !window.confirm(`删除会连带移除下游 ${doomed.length - 1} 张卡片，继续？`)
                    ) {
                      return
                    }
                    for (const id of doomed) cancelRef.current.get(id)?.()
                    setGraph((current) => removeCard(current, card.id))
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 连线由 parentId 推出来，用户没有绘制入口。 */
function Wires({
  graph,
  positions,
}: {
  graph: CanvasGraph
  positions: Record<string, { x: number; y: number }>
}) {
  return (
    <svg className="canvas-wires" aria-hidden="true">
      {graph.cards.map((card) => {
        if (!card.parentId) return null
        const from = positions[card.parentId]
        const to = positions[card.id]
        const parent = findCard(graph, card.parentId)
        if (!from || !to || !parent) return null
        const x1 = from.x + CARD_WIDTH[parent.kind]
        const y1 = from.y + 90
        const x2 = to.x
        const y2 = to.y + 90
        const bend = Math.max(60, (x2 - x1) * 0.5)
        return (
          <path
            key={`${card.parentId}-${card.id}`}
            d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
            className="canvas-wire"
          />
        )
      })}
    </svg>
  )
}
