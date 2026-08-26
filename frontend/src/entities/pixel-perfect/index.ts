export interface PixelPerfectProcessInput {
  imageUrl: string
}

export interface PixelPerfectReconstructInput extends PixelPerfectProcessInput {
  cols: number
  rows: number
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

export interface PixelPerfectReconstructMetadata {
  cols: number
  rows: number
  visibleColors: number
}

export interface PixelPerfectReconstructResult {
  blob: Blob
  filename: string
  metadata: PixelPerfectReconstructMetadata
}

export interface PixelPerfectApis {
  process(input: PixelPerfectProcessInput): Promise<PixelPerfectResult>
  reconstruct(input: PixelPerfectReconstructInput): Promise<PixelPerfectReconstructResult>
}

export { createPixelPerfectApis, pixelPerfectApis } from './api'
