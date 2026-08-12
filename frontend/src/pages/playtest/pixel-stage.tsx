import { useEffect, useRef } from 'react'

import { getPlaytestSceneState, modulo } from './pixel-stage-model'

const WORLD_WIDTH = 144
const WORLD_HEIGHT = 56

const palette = {
  sky: '#f6f7f2',
  far: '#d4e6f4',
  mid: '#719fc4',
  slate: '#647c82',
  green: '#294433',
  dark: '#203628',
  gold: '#c4a66a',
  ground: '#294433',
}

function drawDot(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha = 1,
) {
  context.globalAlpha = alpha
  context.fillStyle = color
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
  context.globalAlpha = 1
}

function drawDotRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  radius = 0.42,
) {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      drawDot(context, x + column, y + row, radius, color)
    }
  }
}

function drawCloud(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const dots = [
    [0, 1],
    [1, 1],
    [2, 0],
    [2, 1],
    [3, 0],
    [3, 1],
    [4, 0],
    [4, 1],
    [5, 1],
    [6, 1],
  ]

  for (const [dotX, dotY] of dots) {
    const centerX = x + dotX * size
    const centerY = y + dotY * size
    drawDot(context, centerX, centerY, size * 0.46, palette.far, 0.96)
    drawDot(context, centerX, centerY, size * 0.24, '#ffffff', 0.9)
  }
}

function drawObstacle(context: CanvasRenderingContext2D, x: number, time: number) {
  const stoneDots = [
    [1, 43],
    [3, 43],
    [5, 43],
    [7, 43],
    [9, 43],
    [2, 41],
    [4, 41],
    [6, 41],
    [8, 41],
    [3, 39],
    [5, 39],
    [7, 39],
    [4, 37],
    [6, 37],
    [5, 35],
  ]

  for (const [dotX, dotY] of stoneDots) {
    const isEdge = dotY === 43 || dotX === 1 || dotX === 9
    drawDot(context, x + dotX, dotY, 0.55, isEdge ? palette.green : palette.slate, 0.96)
  }

  const pulse = 0.72 + Math.sin(time * 0.006) * 0.2
  drawDot(context, x + 5, 38, 0.42, palette.gold, pulse)
  drawDot(context, x + 6, 40, 0.34, palette.gold, pulse * 0.76)
}

function drawScenery(context: CanvasRenderingContext2D, time: number) {
  const farScroll = time * 0.0024
  const midScroll = time * 0.0068
  const { runner, obstacleX } = getPlaytestSceneState(time)

  const overlapsRunner = (x: number, y: number) => {
    const horizontal = (x - (runner.originX + 6)) / 13
    const vertical = (y - (runner.originY + 6)) / 12
    return y < 43 && horizontal * horizontal + vertical * vertical < 1
  }

  for (let x = 0; x <= WORLD_WIDTH; x += 3) {
    const farSample = x + farScroll
    const farTop = 23 + Math.sin(farSample * 0.12) * 4 + Math.sin(farSample * 0.31) * 2
    for (let layer = 0; layer < 4; layer += 1) {
      const y = Math.round(farTop) + layer * 3
      if (!overlapsRunner(x, y)) {
        drawDot(context, x, y, 0.5 - layer * 0.035, palette.far, 0.7 - layer * 0.12)
      }
    }

    const midSample = x + midScroll
    const midTop = 34 + Math.sin(midSample * 0.15) * 2 + Math.sin(midSample * 0.43)
    for (let layer = 0; layer < 3; layer += 1) {
      const y = Math.round(midTop) + layer * 3
      if (!overlapsRunner(x, y)) {
        drawDot(context, x, y, 0.56 - layer * 0.04, palette.mid, 0.78 - layer * 0.14)
      }
    }
  }

  const cloudScroll = time * 0.0016
  for (const [cloudX, cloudY, size] of [
    [18, 8, 2.1],
    [82, 5, 1.8],
    [139, 11, 1.5],
  ] as const) {
    drawCloud(context, modulo(cloudX - cloudScroll + 18, 180) - 18, cloudY, size)
  }

  for (const [speckX, speckY, speed] of [
    [62, 17, 0.001],
    [103, 12, 0.0014],
    [132, 21, 0.0008],
  ] as const) {
    drawDot(context, modulo(speckX - time * speed + 4, 152) - 4, speckY, 0.36, palette.gold, 0.58)
  }

  for (let x = -2; x <= WORLD_WIDTH + 2; x += 1.5) {
    drawDot(context, x, 44, 0.56, palette.ground, 0.98)
  }

  for (let x = -2; x <= WORLD_WIDTH + 2; x += 1.8) {
    drawDot(context, x + 0.7, 46, 0.5, palette.ground, 0.82)
  }

  for (let x = -2; x <= WORLD_WIDTH + 2; x += 2) {
    drawDot(context, x, 48, 0.43, palette.slate, 0.64)
  }

  for (let x = -2; x <= WORLD_WIDTH + 2; x += 2.3) {
    drawDot(context, x + 0.9, 50, 0.36, palette.ground, 0.5)
  }

  for (let x = -2; x <= WORLD_WIDTH + 2; x += 2.8) {
    drawDot(context, x, 52, 0.3, palette.slate, 0.3)
  }

  drawObstacle(context, obstacleX, time)
}

function drawRunner(context: CanvasRenderingContext2D, time: number) {
  const {
    runner: { cycle, jump, runWave, originX, originY },
  } = getPlaytestSceneState(time)

  const shadowWidth = 5 + Math.abs(jump) * 0.32
  const shadowAlpha = 0.42 - Math.abs(jump) * 0.025
  for (let x = -shadowWidth; x <= shadowWidth; x += 2) {
    drawDot(context, originX + 5 + x, 44, 0.55, palette.green, Math.max(0.12, shadowAlpha))
  }

  drawDotRect(context, originX + 3, originY, 4, 1, palette.dark)
  drawDotRect(context, originX + 2, originY + 1, 6, 4, palette.green)
  drawDotRect(context, originX + 3, originY + 5, 5, 4, palette.slate)
  drawDotRect(context, originX + 1, originY + 5, 2, 3, palette.green)

  const scarfWave = Math.round(Math.sin(time * 0.018))
  drawDot(context, originX + 2, originY + 4, 0.44, palette.gold)
  drawDot(context, originX + 1, originY + 4, 0.44, palette.gold)
  for (let index = 0; index < 5; index += 1) {
    const tailLift = index > 1 ? scarfWave : 0
    drawDot(context, originX - index, originY + 4 + tailLift, 0.43, palette.gold)
  }
  drawDot(context, originX - 4, originY + 5 + scarfWave, 0.4, palette.gold)

  if (runWave >= 0) {
    drawDotRect(context, originX + 1, originY + 9, 3, 2, palette.dark)
    drawDotRect(context, originX + 6, originY + 9, 3, 2, palette.dark)
  } else {
    drawDotRect(context, originX + 2, originY + 9, 3, 2, palette.dark)
    drawDotRect(context, originX + 5, originY + 9, 3, 2, palette.dark)
  }

  if (cycle >= 0.76 && cycle <= 0.86) {
    const burst = 1 - Math.abs((cycle - 0.81) / 0.05)
    for (const direction of [-1, 1]) {
      drawDot(
        context,
        originX + 5 + direction * (5 + burst * 4),
        43 - burst * 2,
        0.45,
        palette.green,
        burst,
      )
    }
  }
}

function drawFrame(context: CanvasRenderingContext2D, width: number, height: number, time: number) {
  context.fillStyle = palette.sky
  context.fillRect(0, 0, width, height)

  const scale = Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT)
  const offsetX = (width - WORLD_WIDTH * scale) / 2
  const offsetY = (height - WORLD_HEIGHT * scale) / 2

  context.save()
  context.translate(offsetX, offsetY)
  context.scale(scale, scale)
  drawScenery(context, time)
  drawRunner(context, time)
  context.restore()
}

export function PlaytestPixelStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let frame = 0
    let width = 1
    let height = 1
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      if (reducedMotion) render(0)
    }

    const render = (time: number) => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      drawFrame(context, width, height, time)
      if (!reducedMotion) frame = window.requestAnimationFrame(render)
    }

    resize()
    if (!reducedMotion) render(0)

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    if (!observer) window.addEventListener('resize', resize)

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div data-testid="playtest-pixel-stage" aria-hidden="true" className="playtest-pixel-canvas">
      <canvas ref={canvasRef} data-testid="playtest-dot-canvas" />
    </div>
  )
}
