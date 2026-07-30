/**
 * 工作流画布组件，对齐 skeleton 的节点画布设计。
 * 支持节点拖拽、画布平移/缩放、端口连线。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  ALLOWED_CONNECTIONS,
  INITIAL_NODES,
  NODE_STATUS_CLASSES,
  NODE_STATUS_LABELS,
  type WorkflowNode,
  type WorkflowNodeType,
} from './types'

interface CanvasView {
  x: number
  y: number
  scale: number
}

interface WorkflowCanvasProps {
  onNodeSelect?: (nodeId: WorkflowNodeType) => void
  activeNode?: WorkflowNodeType | null
}

/** 计算贝塞尔曲线路径 — 与 skeleton wirePath 一致 */
function wirePath(start: { x: number; y: number }, end: { x: number; y: number }): string {
  const bend = Math.max(70, Math.abs(end.x - start.x) * 0.46)
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
}

/** 连接 key */
function connectionKey(from: WorkflowNodeType, to: WorkflowNodeType): string {
  return `${from}:${to}`
}

export function WorkflowCanvas({ onNodeSelect, activeNode }: WorkflowCanvasProps) {
  const [nodes, setNodes] = useState<WorkflowNode[]>(INITIAL_NODES)
  const [connections, setConnections] = useState<Set<string>>(new Set())
  const [view, setView] = useState<CanvasView>({ x: 80, y: 120, scale: 0.85 })
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
  const [linkState, setLinkState] = useState<{
    from: WorkflowNodeType
    startX: number
    startY: number
    endX: number
    endY: number
  } | null>(null)
  const [armedFrom, setArmedFrom] = useState<WorkflowNodeType | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  /** 获取节点位置 */
  const getNodePosition = useCallback(
    (nodeId: WorkflowNodeType) => {
      const node = nodes.find((n) => n.id === nodeId)
      return node ? { x: node.x, y: node.y } : { x: 0, y: 0 }
    },
    [nodes],
  )

  /** 检查连接是否存在 */
  const hasConnection = useCallback(
    (from: WorkflowNodeType, to: WorkflowNodeType) => {
      return connections.has(connectionKey(from, to))
    },
    [connections],
  )

  /** 添加连接 */
  const addConnection = useCallback(
    (from: WorkflowNodeType, to: WorkflowNodeType) => {
      const allowed = ALLOWED_CONNECTIONS.some((c) => c.from === from && c.to === to)
      if (!allowed) return false

      setConnections((prev) => {
        const next = new Set(prev)
        next.add(connectionKey(from, to))
        return next
      })
      return true
    },
    [],
  )

  /** 开始拖拽节点 */
  const startNodeDrag = useCallback(
    (event: ReactPointerEvent, nodeId: WorkflowNodeType) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.preventDefault()

      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return

      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'

      setDragState({
        nodeId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: node.x,
        offsetY: node.y,
      })

      viewportRef.current?.setPointerCapture(event.pointerId)
    },
    [nodes],
  )

  /** 开始连线 — 从输出端口拖拽 */
  const startLink = useCallback(
    (event: ReactPointerEvent, fromNode: WorkflowNodeType) => {
      if (event.button !== 0) return
      event.stopPropagation()
      event.preventDefault()

      const node = nodes.find((n) => n.id === fromNode)
      if (!node) return

      const nodeWidth = 280
      const nodeHeight = 180

      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'

      setLinkState({
        from: fromNode,
        startX: node.x + nodeWidth,
        startY: node.y + nodeHeight / 2,
        endX: node.x + nodeWidth,
        endY: node.y + nodeHeight / 2,
      })

      viewportRef.current?.setPointerCapture(event.pointerId)
    },
    [nodes],
  )

  /** 开始平移画布 */
  const startPan = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('[data-node-id], button, input, textarea, select'))
        return

      event.preventDefault()

      document.body.style.userSelect = 'none'
      document.body.style.webkitUserSelect = 'none'

      setPanState({
        startX: event.clientX,
        startY: event.clientY,
        offsetX: view.x,
        offsetY: view.y,
      })

      viewportRef.current?.setPointerCapture(event.pointerId)
    },
    [view.x, view.y],
  )

  /** 指针移动 */
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (dragState) {
        const deltaX = (event.clientX - dragState.startX) / view.scale
        const deltaY = (event.clientY - dragState.startY) / view.scale

        setNodes((prev) =>
          prev.map((node) =>
            node.id === dragState.nodeId
              ? {
                  ...node,
                  x: Math.max(0, dragState.offsetX + deltaX),
                  y: Math.max(0, dragState.offsetY + deltaY),
                }
              : node,
          ),
        )
      }

      if (linkState) {
        const bounds = viewportRef.current?.getBoundingClientRect()
        if (bounds) {
          setLinkState((prev) =>
            prev
              ? {
                  ...prev,
                  endX: (event.clientX - bounds.left - view.x) / view.scale,
                  endY: (event.clientY - bounds.top - view.y) / view.scale,
                }
              : null,
          )
        }
      }

      if (panState) {
        setView((prev) => ({
          ...prev,
          x: panState.offsetX + event.clientX - panState.startX,
          y: panState.offsetY + event.clientY - panState.startY,
        }))
      }
    },
    [dragState, linkState, panState, view.scale, view.x, view.y],
  )

  /** 指针释放 */
  const handlePointerUp = useCallback(
    (event: ReactPointerEvent) => {
      if (dragState) {
        setDragState(null)
      }

      if (linkState) {
        // 检查是否释放在输入端口上
        const target = document.elementFromPoint(event.clientX, event.clientY)
        const inputPort = target?.closest('[data-port="input"]')
        const targetNode = inputPort?.closest('[data-node-id]') as HTMLElement | null
        const toNodeId = targetNode?.dataset.nodeId as WorkflowNodeType | undefined

        if (toNodeId && inputPort) {
          const connected = addConnection(linkState.from, toNodeId)
          if (connected) {
            setArmedFrom(null)
          } else {
            setArmedFrom(linkState.from)
          }
        } else {
          setArmedFrom(linkState.from)
        }

        setLinkState(null)
      }

      if (panState) {
        setPanState(null)
      }

      document.body.style.userSelect = ''
      document.body.style.webkitUserSelect = ''

      viewportRef.current?.releasePointerCapture(event.pointerId)
    },
    [dragState, linkState, panState, addConnection],
  )

  /** 滚轮缩放 */
  const handleWheel = useCallback(
    (event: ReactWheelEvent) => {
      event.preventDefault()
      const delta = event.ctrlKey || event.metaKey ? -event.deltaY * 0.0014 : 0
      if (delta !== 0) {
        setView((prev) => ({
          ...prev,
          scale: Math.min(1.2, Math.max(0.5, prev.scale + delta)),
        }))
      } else {
        setView((prev) => ({
          ...prev,
          x: prev.x - event.deltaX,
          y: prev.y - event.deltaY,
        }))
      }
    },
    [],
  )

  /** 缩放控制 */
  const zoomBy = useCallback((delta: number) => {
    setView((prev) => ({
      ...prev,
      scale: Math.min(1.2, Math.max(0.5, prev.scale + delta)),
    }))
  }, [])

  /** 重置布局 */
  const resetLayout = useCallback(() => {
    setNodes(INITIAL_NODES)
    setView({ x: 80, y: 120, scale: 0.85 })
  }, [])

  /** 获取端口位置 */
  const getPortPosition = useCallback(
    (nodeId: WorkflowNodeType, port: 'input' | 'output') => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return { x: 0, y: 0 }

      const nodeWidth = 280
      const nodeHeight = 180

      if (port === 'output') {
        return { x: node.x + nodeWidth, y: node.y + nodeHeight / 2 }
      }
      return { x: node.x, y: node.y + nodeHeight / 2 }
    },
    [nodes],
  )

  /** 渲染连线 */
  const renderWires = useCallback(() => {
    const wires: JSX.Element[] = []

    // 已连接的线 — 实线
    connections.forEach((key) => {
      const [from, to] = key.split(':') as WorkflowNodeType[]
      const start = getPortPosition(from, 'output')
      const end = getPortPosition(to, 'input')

      wires.push(
        <path
          key={key}
          d={wirePath(start, end)}
          fill="none"
          stroke="#1d1d1f"
          strokeWidth={2.5}
          className="transition-colors"
        />,
      )
    })

    // 建议连接 — 虚线
    ALLOWED_CONNECTIONS.forEach(({ from, to }) => {
      if (hasConnection(from, to)) return

      const fromNode = nodes.find((n) => n.id === from)
      if (!fromNode?.outputEnabled) return

      const start = getPortPosition(from, 'output')
      const end = getPortPosition(to, 'input')

      wires.push(
        <path
          key={`suggested-${from}-${to}`}
          d={wirePath(start, end)}
          fill="none"
          stroke="#c8c2b7"
          strokeWidth={1.5}
          strokeDasharray="8 8"
          className="transition-colors"
        />,
      )
    })

    // 正在拖拽的连线
    if (linkState) {
      wires.push(
        <path
          key="linking"
          d={wirePath(
            { x: linkState.startX, y: linkState.startY },
            { x: linkState.endX, y: linkState.endY },
          )}
          fill="none"
          stroke="#263f2d"
          strokeWidth={2}
          strokeDasharray="6 4"
          className="pointer-events-none"
        />,
      )
    }

    return wires
  }, [connections, nodes, getPortPosition, hasConnection, linkState])

  /** 点击节点 */
  const handleNodeClick = useCallback(
    (nodeId: WorkflowNodeType) => {
      if (armedFrom && armedFrom !== nodeId) {
        const connected = addConnection(armedFrom, nodeId)
        if (connected) {
          setArmedFrom(null)
          return
        }
      }
      setArmedFrom(null)
      onNodeSelect?.(nodeId)
    },
    [onNodeSelect, armedFrom, addConnection],
  )

  /** 点击端口连接 */
  const handlePortClick = useCallback(
    (fromNode: WorkflowNodeType, toNode: WorkflowNodeType) => {
      addConnection(fromNode, toNode)
    },
    [addConnection],
  )

  /** 高亮可连接的输入端口 */
  const isInputHighlighted = useCallback(
    (nodeId: WorkflowNodeType) => {
      if (!armedFrom) return false
      return ALLOWED_CONNECTIONS.some((c) => c.from === armedFrom && c.to === nodeId)
    },
    [armedFrom],
  )

  return (
    <section className="node-graph-workspace">
      {/* 画布视口 */}
      <div
        ref={viewportRef}
        className="node-canvas"
        onPointerDown={startPan}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* 节点表面 */}
        <div
          className="node-surface"
          style={{
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
          }}
        >
          {/* SVG 连线层 */}
          <svg className="node-wires">{renderWires()}</svg>

          {/* 节点层 */}
          {nodes.map((node) => (
            <article
              key={node.id}
              data-node-id={node.id}
              className={`node-card ${activeNode === node.id ? 'is-focused' : ''} ${
                armedFrom === node.id ? 'is-armed' : ''
              } ${isInputHighlighted(node.id) ? 'is-connectable' : ''}`}
              style={{ left: node.x, top: node.y }}
              onClick={() => handleNodeClick(node.id)}
            >
              {/* 输入端口 */}
              {node.hasInput && (
                <button
                  type="button"
                  data-port="input"
                  data-enabled="true"
                  className={`node-port node-port--input ${
                    isInputHighlighted(node.id) ? 'is-highlighted' : ''
                  } ${activeNode === node.id ? 'is-focused' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (armedFrom) {
                      const connected = addConnection(armedFrom, node.id)
                      if (connected) setArmedFrom(null)
                    } else {
                      const candidates = ALLOWED_CONNECTIONS.filter(
                        (c) => c.to === node.id && !hasConnection(c.from, c.to),
                      )
                      if (candidates.length > 0) handlePortClick(candidates[0].from, node.id)
                    }
                  }}
                />
              )}

              {/* 节点头部 — 可拖拽 */}
              <div
                data-node-drag=""
                className="node-card__header"
                onPointerDown={(e) => startNodeDrag(e, node.id)}
              >
                <span className="node-card__eyebrow">{node.eyebrow}</span>
                <span className={`node-card__status ${NODE_STATUS_CLASSES[node.status]}`}>
                  {NODE_STATUS_LABELS[node.status]}
                </span>
                <strong className="node-card__title">{node.title}</strong>
                <p className="node-card__desc">{node.description}</p>
              </div>

              {/* 输出端口 */}
              {node.hasOutput && (
                <button
                  type="button"
                  data-port="output"
                  data-enabled={node.outputEnabled ? 'true' : 'false'}
                  className={`node-port node-port--output ${
                    node.outputEnabled ? 'is-enabled' : 'is-disabled'
                  } ${activeNode === node.id ? 'is-focused' : ''}`}
                  onPointerDown={(e) => {
                    if (node.outputEnabled) startLink(e, node.id)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (node.outputEnabled) {
                      const candidates = ALLOWED_CONNECTIONS.filter(
                        (c) => c.from === node.id && !hasConnection(c.from, c.to),
                      )
                      if (candidates.length > 0) handlePortClick(node.id, candidates[0].to)
                    }
                  }}
                />
              )}

              {/* 选择指示器 */}
              {activeNode === node.id && (
                <div className="node-card__indicator" />
              )}
            </article>
          ))}
        </div>

        {/* 底部提示栏 — 匹配 asset lab 的 node-canvas-hint */}
        <div className="node-canvas-hint">
          <span className="node-canvas-hint__copy">
            <b>{armedFrom ? '点击目标节点完成连接' : '拖拽节点调整布局 · 从输出端口拖拽连线'}</b>
            <span>
              {armedFrom
                ? '点击虚线终点的卡片即可确认连接 · 实线出现后解锁生成'
                : '滚轮缩放画布 · 点击节点查看属性'}
            </span>
          </span>
        </div>

        {/* 缩放控件 — 匹配 asset lab 的 node-zoom */}
        <div className="node-zoom" aria-label="画布缩放">
          <button type="button" aria-label="缩小画布" onClick={() => zoomBy(-0.1)}>
            −
          </button>
          <output aria-live="polite">{Math.round(view.scale * 100)}%</output>
          <button type="button" aria-label="放大画布" onClick={() => zoomBy(0.1)}>
            +
          </button>
          <button type="button" aria-label="重置布局" onClick={resetLayout}>
            ↺
          </button>
        </div>
      </div>
    </section>
  )
}
