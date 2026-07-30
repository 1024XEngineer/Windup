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

/** 计算贝塞尔曲线路径 */
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

      // 防止文字选中
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

  /** 开始平移画布 */
  const startPan = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('[data-node-id], button, input, textarea, select')) return

      event.preventDefault()

      // 防止文字选中
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
              ? { ...node, x: Math.max(0, dragState.offsetX + deltaX), y: Math.max(0, dragState.offsetY + deltaY) }
              : node,
          ),
        )
      }

      if (panState) {
        setView((prev) => ({
          ...prev,
          x: panState.offsetX + event.clientX - panState.startX,
          y: panState.offsetY + event.clientY - panState.startY,
        }))
      }
    },
    [dragState, panState, view.scale],
  )

  /** 指针释放 */
  const handlePointerUp = useCallback(
    (event: ReactPointerEvent) => {
      if (dragState) {
        setDragState(null)
      }
      if (panState) {
        setPanState(null)
      }

      // 恢复文字选中
      document.body.style.userSelect = ''
      document.body.style.webkitUserSelect = ''

      viewportRef.current?.releasePointerCapture(event.pointerId)
    },
    [dragState, panState],
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

      // 节点宽度 280px，高度约 180px
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

    // 已连接的线
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

    // 建议连接（虚线）
    ALLOWED_CONNECTIONS.forEach(({ from, to }) => {
      if (hasConnection(from, to)) return

      const fromNode = nodes.find((n) => n.id === from)
      const toNode = nodes.find((n) => n.id === to)
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

    return wires
  }, [connections, nodes, getPortPosition, hasConnection])

  /** 点击节点 */
  const handleNodeClick = useCallback(
    (nodeId: WorkflowNodeType) => {
      onNodeSelect?.(nodeId)
    },
    [onNodeSelect],
  )

  /** 点击端口连接 */
  const handlePortClick = useCallback(
    (fromNode: WorkflowNodeType, toNode: WorkflowNodeType) => {
      addConnection(fromNode, toNode)
    },
    [addConnection],
  )

  return (
    <section className="flex flex-col overflow-hidden border border-[rgba(31,35,41,0.12)] bg-[#dfe3df] text-[#1d1d1f]">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-[rgba(31,35,41,0.12)] bg-[rgba(223,227,223,0.88)] px-4 py-2">
        <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-[#737378]">
          WORKFLOW CANVAS
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => zoomBy(-0.1)}
            className="grid size-7 place-items-center border border-[rgba(31,35,41,0.12)] bg-white text-sm hover:bg-[#ece9e1]"
          >
            −
          </button>
          <output className="w-10 text-center font-mono text-[10px] text-[#1d1d1f]">
            {Math.round(view.scale * 100)}%
          </output>
          <button
            type="button"
            onClick={() => zoomBy(0.1)}
            className="grid size-7 place-items-center border border-[rgba(31,35,41,0.12)] bg-white text-sm hover:bg-[#ece9e1]"
          >
            +
          </button>
          <button
            type="button"
            onClick={resetLayout}
            className="grid size-7 place-items-center border border-[rgba(31,35,41,0.12)] bg-white text-sm hover:bg-[#ece9e1]"
          >
            ↺
          </button>
        </div>
      </div>

      {/* 画布视口 */}
      <div
        ref={viewportRef}
        className="relative min-h-[600px] flex-1 touch-none select-none overflow-hidden bg-[radial-gradient(rgba(31,35,41,0.06)_1px,transparent_1px)] bg-[size:20px_20px]"
        onPointerDown={startPan}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* 节点表面 */}
        <div
          className="absolute left-0 top-0 origin-[0_0]"
          style={{
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
          }}
        >
          {/* SVG 连线层 */}
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            style={{ width: 3000, height: 1000 }}
          >
            {renderWires()}
          </svg>

          {/* 节点层 */}
          {nodes.map((node) => (
            <article
              key={node.id}
              data-node-id={node.id}
              className={`absolute w-[280px] border p-4 shadow-[0_14px_38px_rgba(29,29,31,0.08)] transition-shadow ${
                activeNode === node.id
                  ? 'border-[#1d1d1f] bg-[#1d1d1f] text-white ring-4 ring-[#1d1d1f]/20'
                  : 'border-[rgba(31,35,41,0.12)] bg-[#ece9e1] text-[#1d1d1f]'
              }`}
              style={{ left: node.x, top: node.y }}
              onClick={() => handleNodeClick(node.id)}
            >
              {/* 输入端口 */}
              {node.hasInput && (
                <button
                  type="button"
                  data-port="input"
                  className={`absolute -left-2 top-1/2 size-4 -translate-y-1/2 rounded-full border-[3px] ${
                    activeNode === node.id
                      ? 'border-white bg-[#1d1d1f]'
                      : 'border-[#c8c2b7] bg-[#dfe3df]'
                  }`}
                  onClick={() => {
                    // 查找可以连接到此节点的源节点
                    const candidates = ALLOWED_CONNECTIONS.filter(
                      (c) => c.to === node.id && !hasConnection(c.from, c.to),
                    )
                    if (candidates.length > 0) {
                      handlePortClick(candidates[0].from, node.id)
                    }
                  }}
                />
              )}

              {/* 节点头部 */}
              <div
                data-node-drag=""
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => startNodeDrag(e, node.id)}
              >
                <span className="flex items-start justify-between gap-2">
                  <span
                    className={`font-mono text-[10px] tracking-[0.12em] ${
                      activeNode === node.id ? 'text-white/60' : 'text-[#737378]'
                    }`}
                  >
                    {node.eyebrow}
                  </span>
                  <span
                    className={`border px-2 py-0.5 text-[10px] font-semibold ${
                      activeNode === node.id
                        ? 'border-white/20 bg-white/10 text-white'
                        : NODE_STATUS_CLASSES[node.status]
                    }`}
                  >
                    {NODE_STATUS_LABELS[node.status]}
                  </span>
                </span>
                <strong
                  className={`mt-2 block text-[15px] font-medium ${
                    activeNode === node.id ? 'text-white' : 'text-[#1d1d1f]'
                  }`}
                >
                  {node.title}
                </strong>
              </div>

              {/* 输出端口 */}
              {node.hasOutput && (
                <button
                  type="button"
                  data-port="output"
                  data-enabled={node.outputEnabled}
                  className={`absolute -right-2 top-1/2 size-4 -translate-y-1/2 rounded-full border-[3px] ${
                    node.outputEnabled
                      ? activeNode === node.id
                        ? 'border-white bg-[#1d1d1f]'
                        : 'border-[#86a18d] bg-[#e9ede9]'
                      : 'border-[#c8c2b7] bg-[#dfe3df]'
                  }`}
                  onClick={() => {
                    // 查找从此节点出发的连接
                    const candidates = ALLOWED_CONNECTIONS.filter(
                      (c) => c.from === node.id && !hasConnection(c.from, c.to),
                    )
                    if (candidates.length > 0) {
                      handlePortClick(node.id, candidates[0].to)
                    }
                  }}
                />
              )}

              {/* 选择指示器 */}
              {activeNode === node.id && (
                <div className="absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 bg-white" />
              )}
            </article>
          ))}
        </div>

        {/* 画布提示 */}
        <div className="absolute bottom-4 left-4 max-w-sm border border-[rgba(31,35,41,0.12)] bg-[rgba(223,227,223,0.9)] p-3 text-xs text-[#737378] shadow-[0_8px_24px_rgba(29,29,31,0.06)]">
          <p className="font-semibold text-[#1d1d1f]">节点工作流</p>
          <p className="mt-1">拖拽节点调整布局 · 点击端口连接节点 · 滚轮缩放画布</p>
        </div>
      </div>
    </section>
  )
}
