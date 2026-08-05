import { describe, expect, it } from 'vitest'

import {
  compareVisualDescriptors,
  createVisualDescriptor,
  silhouetteIntersectionOverUnion,
  structuralSimilarity,
  type VisualDescriptor,
} from './visual-similarity'

function descriptor(
  alpha: readonly number[],
  luminance: readonly number[] = alpha,
  size = 32,
): VisualDescriptor {
  return { size, alpha, luminance }
}

describe('visual similarity', () => {
  it('normalizes small solid sprites without introducing empty grid holes', () => {
    const solid = (size: number) => {
      const data = new Uint8ClampedArray(size * size * 4)
      const subjectPixels = Array.from({ length: size * size }, (_, index) => index)
      for (const index of subjectPixels) {
        data[index * 4] = 120
        data[index * 4 + 1] = 80
        data[index * 4 + 2] = 40
        data[index * 4 + 3] = 255
      }
      return createVisualDescriptor(data, size, subjectPixels, {
        left: 0,
        top: 0,
        width: size,
        height: size,
      })
    }

    const result = compareVisualDescriptors(solid(16), solid(17))

    expect(result?.change).toBeLessThan(0.001)
    expect(result?.silhouetteIoU).toBe(1)
  })

  it('returns perfect similarity for the same normalized subject', () => {
    const values = Array.from({ length: 32 * 32 }, (_, index) => (index % 5 === 0 ? 1 : 0))
    const result = compareVisualDescriptors(descriptor(values), descriptor([...values]))

    expect(result).toEqual({ structuralSimilarity: 1, silhouetteIoU: 1, change: 0 })
  })

  it('separates subjects with different silhouettes and internal structure', () => {
    const left = Array.from({ length: 32 * 32 }, (_, index) => (index % 32 < 8 ? 1 : 0))
    const right = Array.from({ length: 32 * 32 }, (_, index) => (index % 32 >= 24 ? 1 : 0))
    const result = compareVisualDescriptors(descriptor(left), descriptor(right))

    expect(result?.silhouetteIoU).toBe(0)
    expect(result?.change).toBeGreaterThan(0.5)
  })

  it('rejects descriptors with invalid dimensions instead of fabricating a score', () => {
    expect(structuralSimilarity([1], [1], 32)).toBeNull()
    expect(silhouetteIntersectionOverUnion([1], [1, 0])).toBeNull()
    expect(compareVisualDescriptors(descriptor([1]), descriptor([1]))).toBeNull()
  })
})
