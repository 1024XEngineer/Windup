export interface PixelPerfectProcessInput {
  imageUrl: string
}

export interface PixelPerfectMetadata {
  cols: number
  rows: number
  stepX: number
  stepY: number
  consensus: string
  confidence: string
}

export interface PixelPerfectResult {
  blob: Blob
  filename: string
  metadata: PixelPerfectMetadata
}

export interface PixelPerfectApis {
  process(input: PixelPerfectProcessInput): Promise<PixelPerfectResult>
}

export { createPixelPerfectApis, pixelPerfectApis } from './api'
