import { measureFrameGeometry } from './frame-geometry'
import type { FrameGeometryResult } from './sequence-evidence'

function unavailable(reason: string): FrameGeometryResult {
  return { status: 'unavailable', reason }
}

function pixelReadFailure(error: unknown): FrameGeometryResult {
  if (error instanceof DOMException && error.name === 'SecurityError') {
    return unavailable('图片跨域，无法计算像素')
  }

  return unavailable('浏览器无法读取图片像素')
}

let sharedCanvas: HTMLCanvasElement | null = null
let sharedContext: CanvasRenderingContext2D | null = null

function getSharedContext(width: number, height: number): CanvasRenderingContext2D | null {
  if (sharedCanvas === null) {
    sharedCanvas = document.createElement('canvas')
    sharedContext = sharedCanvas.getContext('2d', { willReadFrequently: true })
  }
  if (sharedCanvas.width !== width || sharedCanvas.height !== height) {
    sharedCanvas.width = width
    sharedCanvas.height = height
  }
  return sharedContext
}

export function readImageGeometry(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<FrameGeometryResult> {
  return new Promise((resolve) => {
    const image = new Image()
    let settled = false

    const finish = (result: FrameGeometryResult) => {
      if (settled) return
      settled = true
      image.onload = null
      image.onerror = null
      signal?.removeEventListener('abort', abort)
      resolve(result)
    }
    const abort = () => {
      image.src = ''
      finish(unavailable('分析已取消'))
    }

    image.crossOrigin = 'anonymous'
    image.onload = () => {
      const context = getSharedContext(image.naturalWidth, image.naturalHeight)

      if (context === null) {
        finish(unavailable('浏览器无法读取图片像素'))
        return
      }

      try {
        context.drawImage(image, 0, 0)
        const imageData = context.getImageData(0, 0, image.naturalWidth, image.naturalHeight)
        const geometry = measureFrameGeometry(imageData)
        finish(geometry === null ? unavailable('图片没有可见主体') : { status: 'ready', geometry })
      } catch (error) {
        finish(pixelReadFailure(error))
      }
    }
    image.onerror = () => finish(unavailable('图片加载失败'))

    if (signal?.aborted) {
      abort()
      return
    }

    signal?.addEventListener('abort', abort, { once: true })
    image.src = imageUrl
  })
}
