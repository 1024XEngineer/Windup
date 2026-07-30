/**
 * 节点画布 — 直接使用 asset-lab 的 CSS 类名和 HTML 结构。
 * CSS 来自 workflow-shell.css，不自定义样式。
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import {
  ALLOWED_CONNECTIONS,
  INITIAL_NODES,
  NODE_STATUS_LABELS,
  type WorkflowNode,
  type WorkflowNodeType,
} from './types'

interface WorkflowCanvasProps {
  onNodeSelect?: (nodeId: WorkflowNodeType) => void
  activeNode?: WorkflowNodeType | null
}

function wirePath(start: { x: number; y: number }, end: { x: number; y: number }): string {
  const bend = Math.max(70, Math.abs(end.x - start.x) * 0.46)
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
}

function connectionKey(from: WorkflowNodeType, to: WorkflowNodeType): string {
  return `${from}:${to}`
}

export function WorkflowCanvas({ onNodeSelect, activeNode }: WorkflowCanvasProps) {
  const [nodes] = useState<WorkflowNode[]>(INITIAL_NODES)
  const [connections, setConnections] = useState<Set<string>>(new Set())
  const [view, setView] = useState({ x: 80, y: 120, scale: 0.85 })
  const [dragState, setDragState] = useState<{
    nodeId: WorkflowNodeType
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const [panState, setPanState] = useState<{
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const hasConnection = useCallback(
    (from: WorkflowNodeType, to: WorkflowNodeType) => connections.has(connectionKey(from, to)),
    [connections],
  )

  const addConnection = useCallback((from: WorkflowNodeType, to: WorkflowNodeType) => {
    if (!ALLOWED_CONNECTIONS.some((c) => c.from === from && c.to === to)) return false
    setConnections((prev) => {
      const next = new Set(prev)
      next.add(connectionKey(from, to))
      return next
    })
    return true
  }, [])

  const startNodeDrag = useCallback(
    (event: ReactPointerEvent, nodeId: WorkflowNodeType) => {
      if (event.button !== 0) return
      event.stopPropagation()
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      document.body.style.userSelect = 'none'
      setDragState({ nodeId, startX: event.clientX, startY: event.clientY, offsetX: node.x, offsetY: node.y })
      viewportRef.current?.setPointerCapture(event.pointerId)
    },
    [nodes],
  )

  const startPan = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('[data-node-id], button, input, textarea, select')) return
      document.body.style.userSelect = 'none'
      setPanState({ startX: event.clientX, startY: event.clientY, offsetX: view.x, offsetY: view.y })
      viewportRef.current?.setPointerCapture(event.pointerId)
    },
    [view.x, view.y],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (dragState) {
        // 拖拽节点 — 目前位置固定，不实现拖拽
      }
      if (panState) {
        setView((prev) => ({ ...prev, x: panState.offsetX + event.clientX - panState.startX, y: panState.offsetY + event.clientY - panState.startY }))
      }
    },
    [dragState, panState],
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent) => {
      setDragState(null)
      setPanState(null)
      document.body.style.userSelect = ''
      viewportRef.current?.releasePointerCapture(event.pointerId)
    },
    [],
  )

  const handleWheel = useCallback((event: ReactWheelEvent) => {
    event.preventDefault()
    const delta = event.ctrlKey || event.metaKey ? -event.deltaY * 0.0014 : 0
    if (delta !== 0) setView((prev) => ({ ...prev, scale: Math.min(1.2, Math.max(0.5, prev.scale + delta)) }))
    else setView((prev) => ({ ...prev, x: prev.x - event.deltaX, y: prev.y - event.deltaY }))
  }, [])

  const getPortPosition = useCallback(
    (nodeId: WorkflowNodeType, port: 'input' | 'output') => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return { x: 0, y: 0 }
      return port === 'output' ? { x: node.x + 292, y: node.y + 60 } : { x: node.x, y: node.y + 60 }
    },
    [nodes],
  )

  const renderWires = useCallback(() => {
    const wires: JSX.Element[] = []
    connections.forEach((key) => {
      const [from, to] = key.split(':') as WorkflowNodeType[]
      wires.push(<path key={key} d={wirePath(getPortPosition(from, 'output'), getPortPosition(to, 'input'))} fill="none" className="node-wire is-connected" />)
    })
    ALLOWED_CONNECTIONS.forEach(({ from, to }) => {
      if (hasConnection(from, to)) return
      const fromNode = nodes.find((n) => n.id === from)
      if (!fromNode?.outputEnabled) return
      wires.push(<path key={`s-${from}-${to}`} d={wirePath(getPortPosition(from, 'output'), getPortPosition(to, 'input'))} fill="none" className="node-wire is-drafting" />)
    })
    return wires
  }, [connections, nodes, getPortPosition, hasConnection])

  const zoomBy = useCallback((d: number) => setView((prev) => ({ ...prev, scale: Math.min(1.2, Math.max(0.5, prev.scale + d)) })), [])
  const resetLayout = useCallback(() => setView({ x: 80, y: 120, scale: 0.85 }), [])

  return (
    <section className="node-graph-workspace">
      <div
        ref={viewportRef}
        className={`node-canvas${panState ? ' is-panning' : ''}`}
        onPointerDown={startPan}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <div className="node-surface" style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}>
          <svg className="node-wires">{renderWires()}</svg>

          {nodes.map((node) => (
            <article
              key={node.id}
              data-node-id={node.id}
              data-node-focus={String(activeNode === node.id)}
              className={`graph-node${node.hasInput ? ' has-input' : ''}`}
              style={{ left: node.x, top: node.y }}
              onClick={() => onNodeSelect?.(node.id)}
            >
              {node.hasInput && (
                <button type="button" className="graph-port graph-port--input" aria-label="输入端口" data-port="input" data-enabled="true" onClick={(e) => {
                  e.stopPropagation()
                  const candidates = ALLOWED_CONNECTIONS.filter((c) => c.to === node.id && !hasConnection(c.from, c.to))
                  if (candidates.length > 0) addConnection(candidates[0].from, node.id)
                }} />
              )}
              <header data-node-drag="" onPointerDown={(e) => startNodeDrag(e, node.id)}>
                <span>
                  <small>{node.eyebrow}</small>
                  <h2>{node.title}</h2>
                </span>
                <i aria-hidden="true"><b /><b /><b /></i>
              </header>
              <div className="graph-node__body">
                <div className={`node-status node-status--${node.status}`}>
                  <span>{node.title}</span>
                  <b>{NODE_STATUS_LABELS[node.status]}</b>
                </div>
              </div>
              {node.hasOutput && (
                <button type="button" className={`graph-port graph-port--output`} aria-label="输出端口" data-port="output" data-enabled={String(node.outputEnabled)} onClick={(e) => {
                  e.stopPropagation()
                  if (!node.outputEnabled) return
                  const candidates = ALLOWED_CONNECTIONS.filter((c) => c.from === node.id && !hasConnection(c.from, c.to))
                  if (candidates.length > 0) addConnection(node.id, candidates[0].to)
                }} />
              )}
            </article>
          ))}
        </div>

        <div className="node-canvas-hint">
          <span className="node-canvas-hint__copy">
            <b>拖拽节点调整布局 · 点击端口连接节点</b>
            <span>滚轮缩放画布 · 点击节点查看属性</span>
          </span>
        </div>

        <div className="node-zoom" aria-label="画布缩放">
          <button type="button" aria-label="缩小画布" onClick={() => zoomBy(-0.1)}>−</button>
          <output aria-live="polite">{Math.round(view.scale * 100)}%</output>
          <button type="button" aria-label="放大画布" onClick={() => zoomBy(0.1)}>+</button>
          <button type="button" aria-label="重置布局" onClick={resetLayout}>↺</button>
        </div>
      </div>
    </section>
  )
}
