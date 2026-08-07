/**
 * 节点画布控制器 — 直接移植 asset-lab 的 NodeCanvasController。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

function wirePath(start: { x: number; y: number }, end: { x: number; y: number }): string {
  const bend = Math.max(70, Math.abs(end.x - start.x) * 0.46)
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
}

export class NodeCanvasController {
  connections: Set<string>
  positions: Record<string, { x: number; y: number }>
  scale: number
  pan: { x: number; y: number }
  root: HTMLElement | null
  viewport: HTMLElement | null
  surface: HTMLElement | null
  wires: SVGSVGElement | null
  abortController: AbortController | null

  constructor() {
    this.connections = new Set()
    this.positions = {}
    this.scale = 1
    this.pan = { x: 80, y: 120 }
    this.root = null
    this.viewport = null
    this.surface = null
    this.wires = null
    this.abortController = null
  }

  attach(root: HTMLElement) {
    this.detach()
    this.abortController = new AbortController()
    this.root = root
    this.viewport = root.querySelector('[data-node-canvas]')
    this.surface = root.querySelector('[data-node-surface]')
    this.wires = root.querySelector('[data-node-wires]') as unknown as SVGSVGElement
    if (!this.viewport || !this.surface || !this.wires) return

    const options = { signal: this.abortController.signal }

    this.surface.querySelectorAll('[data-node-id]').forEach((node) => {
      const el = node as HTMLElement
      const id = el.dataset.nodeId!
      const saved = this.positions[id]
      if (saved) {
        el.style.left = `${saved.x}px`
        el.style.top = `${saved.y}px`
      }
      el.querySelector('[data-node-drag]')?.addEventListener(
        'pointerdown',
        (event) => {
          this.startNodeDrag(event as PointerEvent, el)
        },
        options,
      )
    })

    this.viewport.addEventListener(
      'pointerdown',
      (event) => {
        this.startPan(event as PointerEvent)
      },
      options,
    )
    this.viewport.addEventListener(
      'pointermove',
      (event) => {
        this.pointerMove(event as PointerEvent)
      },
      options,
    )
    this.viewport.addEventListener(
      'pointerup',
      (event) => {
        this.pointerUp(event as PointerEvent)
      },
      options,
    )
    this.viewport.addEventListener(
      'wheel',
      (event) => {
        this.wheel(event as WheelEvent)
      },
      { ...options, passive: false },
    )

    root
      .querySelector('[data-node-zoom-in]')
      ?.addEventListener('click', () => this.zoomBy(0.1), options)
    root
      .querySelector('[data-node-zoom-out]')
      ?.addEventListener('click', () => this.zoomBy(-0.1), options)
    root
      .querySelector('[data-node-arrange]')
      ?.addEventListener('click', () => this.resetLayout(), options)

    this.applyTransform()
    this.renderWires()
  }

  detach() {
    this.abortController?.abort()
    this.abortController = null
  }

  startNodeDrag(event: PointerEvent, node: HTMLElement) {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = parseFloat(node.style.left) || 0
    const startTop = parseFloat(node.style.top) || 0
    node.classList.add('is-dragging')
    node.setPointerCapture(event.pointerId)

    const onMove = (e: PointerEvent) => {
      const x = startLeft + (e.clientX - startX) / this.scale
      const y = startTop + (e.clientY - startY) / this.scale
      node.style.left = `${Math.max(0, x)}px`
      node.style.top = `${Math.max(0, y)}px`
      this.renderWires()
    }
    const onUp = (e: PointerEvent) => {
      node.classList.remove('is-dragging')
      this.positions[node.dataset.nodeId!] = {
        x: parseFloat(node.style.left) || 0,
        y: parseFloat(node.style.top) || 0,
      }
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', onUp)
      node.releasePointerCapture(e.pointerId)
    }
    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerup', onUp)
  }

  startPan(event: PointerEvent) {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('[data-node-id], button, input, textarea, select')) return
    const startX = event.clientX
    const startY = event.clientY
    const startPanX = this.pan.x
    const startPanY = this.pan.y
    this.viewport?.setPointerCapture(event.pointerId)
    this.viewport?.classList.add('is-panning')

    const onMove = (e: PointerEvent) => {
      this.pan.x = startPanX + e.clientX - startX
      this.pan.y = startPanY + e.clientY - startY
      this.applyTransform()
    }
    const onUp = (e: PointerEvent) => {
      this.viewport?.classList.remove('is-panning')
      this.viewport?.removeEventListener('pointermove', onMove)
      this.viewport?.removeEventListener('pointerup', onUp)
      this.viewport?.releasePointerCapture(e.pointerId)
    }
    this.viewport?.addEventListener('pointermove', onMove)
    this.viewport?.addEventListener('pointerup', onUp)
  }

  pointerMove(_event: PointerEvent) {}
  pointerUp(_event: PointerEvent) {}

  wheel(event: WheelEvent) {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) this.zoomBy(-event.deltaY * 0.0014)
    else {
      this.pan.x -= event.deltaX
      this.pan.y -= event.deltaY
      this.applyTransform()
    }
  }

  zoomBy(delta: number) {
    this.scale = Math.min(1.2, Math.max(0.5, this.scale + delta))
    this.applyTransform()
    this.renderWires()
  }

  applyTransform() {
    if (!this.surface) return
    this.surface.style.transform = `translate3d(${this.pan.x}px, ${this.pan.y}px, 0) scale(${this.scale})`
    const label = this.root?.querySelector('[data-node-zoom-label]')
    if (label) label.textContent = `${Math.round(this.scale * 100)}%`
  }

  resetLayout() {
    this.positions = {}
    this.surface?.querySelectorAll('[data-node-id]').forEach((node) => {
      const el = node as HTMLElement
      el.style.left = `${el.dataset.x || 0}px`
      el.style.top = `${el.dataset.y || 0}px`
    })
    this.pan = { x: 80, y: 120 }
    this.scale = 1
    this.applyTransform()
    this.renderWires()
  }

  renderWires() {
    if (!this.wires) return
    this.wires.replaceChildren()

    // 已连接的线 — 实线
    this.connections.forEach((key) => {
      const [from, to] = JSON.parse(key) as [string, string]
      const output = this.surface?.querySelector(
        `[data-node-id="${from}"] [data-port="output"]`,
      ) as HTMLElement
      const input = this.surface?.querySelector(
        `[data-node-id="${to}"] [data-port="input"]`,
      ) as HTMLElement
      if (!output || !input) return
      this.appendWire(this.portPoint(output), this.portPoint(input), 'node-wire is-connected')
    })

    // DOM 顺序就是当前 Revision 的真实节点顺序。按相邻节点连线后，新增动作对
    // 会自然接在旧审核之后，不再依赖只能描述固定五步的类型白名单。
    const nodes = Array.from(this.surface?.querySelectorAll('[data-node-id]') ?? [])
    nodes.forEach((node, index) => {
      const el = node as HTMLElement
      const output = el.querySelector(
        '[data-port="output"][data-enabled="true"]',
      ) as HTMLElement | null
      if (!output) return
      const next = nodes[index + 1] as HTMLElement | undefined
      const input = next?.querySelector('[data-port="input"]') as HTMLElement | null
      if (!input) return
      this.appendWire(this.portPoint(output), this.portPoint(input), 'node-wire is-suggested')
    })
  }

  appendWire(start: { x: number; y: number }, end: { x: number; y: number }, className: string) {
    if (!this.wires) return
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', wirePath(start, end))
    path.setAttribute('class', className)
    this.wires.append(path)
  }

  portPoint(port: HTMLElement): { x: number; y: number } {
    if (!this.surface) return { x: 0, y: 0 }
    const surfaceBounds = this.surface.getBoundingClientRect()
    const bounds = port.getBoundingClientRect()
    return {
      x: (bounds.left + bounds.width / 2 - surfaceBounds.left) / this.scale,
      y: (bounds.top + bounds.height / 2 - surfaceBounds.top) / this.scale,
    }
  }

  setConnections(connections: Array<{ from: string; to: string }>) {
    // Node ID 自身包含冒号，JSON 元组避免用字符串分隔符时发生截断。
    this.connections = new Set(connections.map(({ from, to }) => JSON.stringify([from, to])))
    this.renderWires()
  }
}
