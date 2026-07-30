/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readImageGeometry } from './image-geometry'

type ImageBehavior = 'load' | 'error' | 'pending'

let imageBehavior: ImageBehavior
let crossOriginAtSourceAssignment: string | null
let lastAssignedSource: string
let canvasContext: Pick<CanvasRenderingContext2D, 'drawImage' | 'getImageData'> | null

class FakeImage {
  crossOrigin: string | null = null
  naturalWidth = 2
  naturalHeight = 2
  onerror: OnErrorEventHandler | null = null
  onload: ((this: GlobalEventHandlers, event: Event) => unknown) | null = null
  private source = ''

  get src(): string {
    return this.source
  }

  set src(value: string) {
    this.source = value
    crossOriginAtSourceAssignment = this.crossOrigin
    lastAssignedSource = value
    if (value === '' || imageBehavior === 'pending') return

    queueMicrotask(() => {
      if (imageBehavior === 'load') this.onload?.call(this as never, new Event('load'))
      else this.onerror?.call(this as never, 'error', '', 0, 0, new Error('load failed'))
    })
  }
}

function pixelsWithAlpha(alpha: number): ImageData {
  const data = new Uint8ClampedArray(2 * 2 * 4)
  data[3] = alpha
  return { data, width: 2, height: 2, colorSpace: 'srgb' } as ImageData
}

beforeEach(() => {
  imageBehavior = 'load'
  crossOriginAtSourceAssignment = null
  lastAssignedSource = ''
  canvasContext = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => pixelsWithAlpha(255)),
  }
  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName !== 'canvas')
      return document.createElementNS('http://www.w3.org/1999/xhtml', tagName)
    return {
      width: 0,
      height: 0,
      getContext: () => canvasContext,
    } as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('readImageGeometry', () => {
  it('requests anonymous image access before reading real Canvas pixels', async () => {
    // Catches crossOrigin being assigned after src or a placeholder geometry replacing actual pixels.
    const result = await readImageGeometry('https://cdn.example.test/frame.png')

    expect(crossOriginAtSourceAssignment).toBe('anonymous')
    expect(result).toEqual({
      status: 'ready',
      geometry: {
        width: 2,
        height: 2,
        bounds: { left: 0, top: 0, right: 0, bottom: 0, width: 1, height: 1 },
        centroid: { x: 0, y: 0 },
        footY: 0,
        subjectHeight: 1,
        opaquePixels: 1,
        coverageRatio: 0.25,
        fingerprint: expect.any(Array),
      },
    })
  })

  it('reports asset, Canvas and transparent-frame failures instead of zero evidence', async () => {
    // Catches unavailable evidence being silently presented as a successful zero measurement.
    imageBehavior = 'error'
    await expect(readImageGeometry('/missing.png')).resolves.toEqual({
      status: 'unavailable',
      reason: '图片加载失败',
    })

    imageBehavior = 'load'
    canvasContext = null
    await expect(readImageGeometry('/no-canvas.png')).resolves.toEqual({
      status: 'unavailable',
      reason: '浏览器无法读取图片像素',
    })

    canvasContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => pixelsWithAlpha(24)),
    }
    await expect(readImageGeometry('/transparent.png')).resolves.toEqual({
      status: 'unavailable',
      reason: '图片没有可见主体',
    })
  })

  it('reports a tainted Canvas as a cross-origin pixel failure', async () => {
    // Catches signed remote images being mislabelled as transparent or valid when CORS blocks inspection.
    canvasContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new DOMException('tainted', 'SecurityError')
      }),
    }

    await expect(readImageGeometry('https://remote.example.test/frame.png')).resolves.toEqual({
      status: 'unavailable',
      reason: '图片跨域，无法计算像素',
    })
  })

  it('cancels a pending image read through AbortSignal', async () => {
    // Catches a stale sequence load surviving a direction switch and updating the new review.
    imageBehavior = 'pending'
    const controller = new AbortController()
    const result = readImageGeometry('/slow.png', controller.signal)

    controller.abort()

    await expect(result).resolves.toEqual({
      status: 'unavailable',
      reason: '分析已取消',
    })
    expect(lastAssignedSource).toBe('')
  })
})
