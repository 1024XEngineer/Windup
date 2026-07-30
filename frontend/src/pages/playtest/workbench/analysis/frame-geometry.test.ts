import { describe, expect, it } from 'vitest'

import { measureFrameGeometry, type FramePixelData } from './frame-geometry'

function createPixels(
  width: number,
  height: number,
  visible: readonly { x: number; y: number; alpha: number }[],
): FramePixelData {
  const data = new Uint8ClampedArray(width * height * 4)

  for (const pixel of visible) data[(pixel.y * width + pixel.x) * 4 + 3] = pixel.alpha

  return { data, width, height }
}

describe('measureFrameGeometry', () => {
  it('treats only alpha values greater than 24 as visible', () => {
    // Catches the review algorithm including matte noise at the old Alpha cutoff.
    expect(measureFrameGeometry(createPixels(1, 1, [{ x: 0, y: 0, alpha: 24 }]))).toBeNull()
    expect(measureFrameGeometry(createPixels(1, 1, [{ x: 0, y: 0, alpha: 25 }]))).toMatchObject({
      opaquePixels: 1,
      coverageRatio: 1,
    })
  })

  it('measures bounds, centroid, foot line, height, area and coverage from visible pixels', () => {
    // Catches off-by-one bounds or a centroid derived from the box instead of real visible pixels.
    const geometry = measureFrameGeometry(
      createPixels(4, 4, [
        { x: 1, y: 1, alpha: 255 },
        { x: 2, y: 1, alpha: 255 },
        { x: 1, y: 2, alpha: 255 },
        { x: 2, y: 2, alpha: 255 },
      ]),
    )

    expect(geometry).toEqual({
      width: 4,
      height: 4,
      bounds: { left: 1, top: 1, right: 2, bottom: 2, width: 2, height: 2 },
      centroid: { x: 1.5, y: 1.5 },
      footY: 2,
      subjectHeight: 2,
      opaquePixels: 4,
      coverageRatio: 0.25,
      fingerprint: expect.any(Array),
    })
    expect(geometry?.fingerprint).toHaveLength(64)
  })

  it('produces different compact fingerprints for different silhouettes with equal bounds', () => {
    const leftTop = measureFrameGeometry(
      createPixels(4, 4, [
        { x: 0, y: 0, alpha: 255 },
        { x: 1, y: 0, alpha: 255 },
        { x: 2, y: 0, alpha: 255 },
        { x: 3, y: 0, alpha: 255 },
        { x: 3, y: 1, alpha: 255 },
        { x: 3, y: 2, alpha: 255 },
        { x: 3, y: 3, alpha: 255 },
      ]),
    )
    const leftBottom = measureFrameGeometry(
      createPixels(4, 4, [
        { x: 0, y: 0, alpha: 255 },
        { x: 0, y: 1, alpha: 255 },
        { x: 0, y: 2, alpha: 255 },
        { x: 0, y: 3, alpha: 255 },
        { x: 1, y: 3, alpha: 255 },
        { x: 2, y: 3, alpha: 255 },
        { x: 3, y: 3, alpha: 255 },
      ]),
    )

    expect(leftTop?.bounds).toEqual(leftBottom?.bounds)
    expect(leftTop?.fingerprint).not.toEqual(leftBottom?.fingerprint)
  })

  it('keeps small dark silhouettes distinguishable instead of diluting them across the canvas', () => {
    const topLeft: Array<{ x: number; y: number; alpha: number }> = []
    const bottomRight: Array<{ x: number; y: number; alpha: number }> = []
    for (let y = 96; y < 160; y += 1) {
      for (let x = 96; x < 160; x += 1) {
        if (y < 128 || x < 112) topLeft.push({ x, y, alpha: 255 })
        if (y >= 128 || x >= 144) bottomRight.push({ x, y, alpha: 255 })
      }
    }
    const first = measureFrameGeometry(createPixels(256, 256, topLeft))
    const second = measureFrameGeometry(createPixels(256, 256, bottomRight))
    const distance =
      first?.fingerprint?.reduce(
        (total, value, index) => total + Math.abs(value - (second?.fingerprint?.[index] ?? value)),
        0,
      ) ?? 0

    expect(first?.bounds).toEqual(second?.bounds)
    expect(distance / 64).toBeGreaterThan(0.02)
  })

  it('rejects an RGBA buffer whose dimensions do not match its length', () => {
    // Catches silent geometry corruption when Canvas data and dimensions diverge.
    expect(() =>
      measureFrameGeometry({ data: new Uint8ClampedArray(4), width: 2, height: 2 }),
    ).toThrowError('RGBA 像素长度与画布尺寸不一致')
  })

  it('ignores a tiny isolated Alpha component outside the visible subject', () => {
    // Catches one stray generated pixel moving the measured foot line and centroid.
    const geometry = measureFrameGeometry(
      createPixels(4, 4, [
        { x: 0, y: 0, alpha: 255 },
        { x: 1, y: 0, alpha: 255 },
        { x: 0, y: 1, alpha: 255 },
        { x: 1, y: 1, alpha: 255 },
        { x: 3, y: 3, alpha: 255 },
      ]),
    )

    expect(geometry).toMatchObject({
      bounds: { left: 0, top: 0, right: 1, bottom: 1, width: 2, height: 2 },
      centroid: { x: 0.5, y: 0.5 },
      footY: 1,
      opaquePixels: 4,
      coverageRatio: 0.25,
    })
  })
})
