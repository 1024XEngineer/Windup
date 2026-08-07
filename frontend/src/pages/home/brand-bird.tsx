import { useEffect, useRef } from 'react'

const SAMPLE_SIZE = 48
const MAX_DPR = 2
const WAVE_DURATION = 7200

interface BrandPoint {
  accent: boolean
  luminance: number
  x: number
  y: number
}

function smoothStep(value: number) {
  return value * value * (3 - 2 * value)
}

function sampleMark(image: HTMLImageElement): BrandPoint[] {
  const sample = document.createElement('canvas')
  sample.width = SAMPLE_SIZE
  sample.height = SAMPLE_SIZE
  const context = sample.getContext('2d', { willReadFrequently: true })
  if (!context) return []

  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  const points: BrandPoint[] = []

  for (let y = 0; y < SAMPLE_SIZE; y += 1) {
    for (let x = 0; x < SAMPLE_SIZE; x += 1) {
      if (pixels[(y * SAMPLE_SIZE + x) * 4 + 3] < 80) continue
      const centerLight = Math.max(
        0,
        1 - Math.hypot(x / SAMPLE_SIZE - 0.5, y / SAMPLE_SIZE - 0.5) / 0.7,
      )
      points.push({
        accent: Math.hypot(x - SAMPLE_SIZE * 0.44, y - SAMPLE_SIZE * 0.5) < SAMPLE_SIZE * 0.055,
        luminance: 0.34 + centerLight * 0.3,
        x: x / (SAMPLE_SIZE - 1),
        y: y / (SAMPLE_SIZE - 1),
      })
    }
  }

  return points
}

/** livedemo 主屏点阵小鸟；仅作为主页背景，不接入页面业务。 */
export function HomeBrandBird() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const context = canvas.getContext('2d')
    if (!context) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const image = new Image()
    image.decoding = 'async'
    image.src = '/windup-mark.svg'

    let animationFrame = 0
    let points: BrandPoint[] = []
    let width = 1
    let height = 1

    function draw(time = 0) {
      context!.clearRect(0, 0, width, height)
      if (!points.length) return

      const markSize = Math.min(width * 0.36, height * 0.66, 576)
      const originX = Math.max(18, width * 0.02)
      const originY = height - markSize * 0.9
      const dotRadius = Math.max(1.15, Math.min(3.6, markSize / 155))
      const waveProgress = reduceMotion ? 0.5 : (time % WAVE_DURATION) / WAVE_DURATION
      const primaryCenter = originX + (waveProgress * 1.42 - 0.2) * markSize
      const echoProgress = (waveProgress + 0.52) % 1
      const echoCenter = originX + (echoProgress * 1.42 - 0.2) * markSize
      const spread = markSize * 0.15

      for (const point of points) {
        const baseX = originX + point.x * markSize
        const baseY = originY + point.y * markSize
        const primaryDistance = baseX - primaryCenter
        const echoDistance = baseX - echoCenter
        const primaryWave = reduceMotion
          ? 0
          : Math.sin(primaryDistance / 14) * Math.exp(-((primaryDistance / spread) ** 2))
        const echoWave = reduceMotion
          ? 0
          : Math.sin(echoDistance / 17) * Math.exp(-((echoDistance / spread) ** 2)) * 0.42
        const displacement = (primaryWave + echoWave) * 4.2 * (0.38 + smoothStep(point.x) * 0.62)
        const lightBand = primaryWave * 0.2 + echoWave * 0.1
        const opacity = Math.max(0.16, Math.min(0.92, point.luminance + lightBand))

        context!.beginPath()
        context!.arc(
          baseX + displacement * 0.18,
          baseY + displacement,
          dotRadius + Math.max(0, lightBand) * 1.35,
          0,
          Math.PI * 2,
        )
        context!.fillStyle = point.accent
          ? `rgba(176, 119, 47, ${Math.min(0.76, opacity + 0.12)})`
          : `rgba(38, 63, 45, ${opacity * 0.38})`
        context!.fill()
      }
    }

    function resize() {
      const bounds = canvas!.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas!.width = Math.round(width * dpr)
      canvas!.height = Math.round(height * dpr)
      context!.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }

    function animate(time: number) {
      draw(time)
      animationFrame = window.requestAnimationFrame(animate)
    }

    function load() {
      points = sampleMark(image)
      draw()
      if (!reduceMotion) animationFrame = window.requestAnimationFrame(animate)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    image.addEventListener('load', load, { once: true })
    resize()

    return () => {
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
      image.removeEventListener('load', load)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      data-testid="home-brand-bird"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-75"
    />
  )
}
