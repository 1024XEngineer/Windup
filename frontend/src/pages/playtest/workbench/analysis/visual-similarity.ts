const GRID_SIZE = 32
const SSIM_WINDOW_SIZE = 8
const ALPHA_MASK_THRESHOLD = 0.2

export interface VisualDescriptor {
  /** The subject crop normalized onto a stable square grid, so canvas translation does not count as drift. */
  size: number
  alpha: readonly number[]
  luminance: readonly number[]
}

export interface VisualSimilarity {
  structuralSimilarity: number
  silhouetteIoU: number
  change: number
}

interface DescriptorBounds {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Builds a translation- and scale-normalized foreground descriptor from browser RGBA pixels.
 * Every target cell samples its corresponding source area. This works in both directions: large
 * sprites are box-filtered and sprites below 32px are enlarged without introducing empty holes.
 */
export function createVisualDescriptor(
  data: Uint8ClampedArray,
  sourceWidth: number,
  subjectPixels: readonly number[],
  bounds: DescriptorBounds,
): VisualDescriptor {
  const cells = GRID_SIZE * GRID_SIZE
  const alphaSums = new Float64Array(cells)
  const luminanceSums = new Float64Array(cells)
  const subjectMask = new Uint8Array(data.length / 4)

  for (const index of subjectPixels) subjectMask[index] = 1

  for (let cellY = 0; cellY < GRID_SIZE; cellY += 1) {
    const sourceTop = Math.floor((cellY * bounds.height) / GRID_SIZE)
    const sourceBottom = Math.max(
      sourceTop + 1,
      Math.ceil(((cellY + 1) * bounds.height) / GRID_SIZE),
    )
    for (let cellX = 0; cellX < GRID_SIZE; cellX += 1) {
      const sourceLeft = Math.floor((cellX * bounds.width) / GRID_SIZE)
      const sourceRight = Math.max(
        sourceLeft + 1,
        Math.ceil(((cellX + 1) * bounds.width) / GRID_SIZE),
      )
      const cell = cellY * GRID_SIZE + cellX
      let samples = 0

      for (let localY = sourceTop; localY < sourceBottom; localY += 1) {
        for (let localX = sourceLeft; localX < sourceRight; localX += 1) {
          const sourceIndex = (bounds.top + localY) * sourceWidth + bounds.left + localX
          samples += 1
          if (subjectMask[sourceIndex] === 0) continue

          const offset = sourceIndex * 4
          const alpha = (data[offset + 3] ?? 0) / 255
          const luminance =
            ((data[offset] ?? 0) * 0.2126 +
              (data[offset + 1] ?? 0) * 0.7152 +
              (data[offset + 2] ?? 0) * 0.0722) /
            255
          alphaSums[cell] += alpha
          luminanceSums[cell] += luminance * alpha
        }
      }

      alphaSums[cell] /= samples
      luminanceSums[cell] /= samples
    }
  }

  const normalize = (values: Float64Array): readonly number[] =>
    Array.from(values, (value) => Number(value.toFixed(5)))

  return {
    size: GRID_SIZE,
    alpha: normalize(alphaSums),
    luminance: normalize(luminanceSums),
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

/**
 * Windowed SSIM follows Wang et al.'s structural-similarity formula. The descriptor is already
 * normalized to [0, 1], therefore the standard K1=0.01 and K2=0.03 constants can be used directly.
 */
export function structuralSimilarity(
  left: readonly number[],
  right: readonly number[],
  size: number,
): number | null {
  if (left.length !== size * size || right.length !== left.length || size < SSIM_WINDOW_SIZE) {
    return null
  }

  const c1 = 0.01 ** 2
  const c2 = 0.03 ** 2
  const windowScores: number[] = []

  for (let top = 0; top < size; top += SSIM_WINDOW_SIZE) {
    for (let leftEdge = 0; leftEdge < size; leftEdge += SSIM_WINDOW_SIZE) {
      const leftWindow: number[] = []
      const rightWindow: number[] = []
      for (let y = top; y < Math.min(size, top + SSIM_WINDOW_SIZE); y += 1) {
        for (let x = leftEdge; x < Math.min(size, leftEdge + SSIM_WINDOW_SIZE); x += 1) {
          const index = y * size + x
          leftWindow.push(left[index] ?? 0)
          rightWindow.push(right[index] ?? 0)
        }
      }

      const leftMean = mean(leftWindow)
      const rightMean = mean(rightWindow)
      let leftVariance = 0
      let rightVariance = 0
      let covariance = 0
      for (let index = 0; index < leftWindow.length; index += 1) {
        const leftOffset = (leftWindow[index] ?? 0) - leftMean
        const rightOffset = (rightWindow[index] ?? 0) - rightMean
        leftVariance += leftOffset * leftOffset
        rightVariance += rightOffset * rightOffset
        covariance += leftOffset * rightOffset
      }
      const divisor = Math.max(1, leftWindow.length - 1)
      leftVariance /= divisor
      rightVariance /= divisor
      covariance /= divisor

      const numerator = (2 * leftMean * rightMean + c1) * (2 * covariance + c2)
      const denominator =
        (leftMean ** 2 + rightMean ** 2 + c1) * (leftVariance + rightVariance + c2)
      windowScores.push(denominator === 0 ? 1 : numerator / denominator)
    }
  }

  return Math.max(-1, Math.min(1, mean(windowScores)))
}

export function silhouetteIntersectionOverUnion(
  left: readonly number[],
  right: readonly number[],
): number | null {
  if (left.length === 0 || left.length !== right.length) return null

  let intersection = 0
  let union = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftVisible = (left[index] ?? 0) >= ALPHA_MASK_THRESHOLD
    const rightVisible = (right[index] ?? 0) >= ALPHA_MASK_THRESHOLD
    if (leftVisible && rightVisible) intersection += 1
    if (leftVisible || rightVisible) union += 1
  }

  return union === 0 ? 1 : intersection / union
}

export function compareVisualDescriptors(
  left: VisualDescriptor | undefined,
  right: VisualDescriptor | undefined,
): VisualSimilarity | null {
  if (left === undefined || right === undefined || left.size !== right.size) return null

  const alphaSsim = structuralSimilarity(left.alpha, right.alpha, left.size)
  const luminanceSsim = structuralSimilarity(left.luminance, right.luminance, left.size)
  const silhouetteIoU = silhouetteIntersectionOverUnion(left.alpha, right.alpha)
  if (alphaSsim === null || luminanceSsim === null || silhouetteIoU === null) return null

  // Alpha carries shape continuity; luminance adds costume and internal-detail evidence.
  const ssim = Math.max(0, Math.min(1, alphaSsim * 0.55 + luminanceSsim * 0.45))
  const change = 1 - (ssim * 0.7 + silhouetteIoU * 0.3)

  return {
    structuralSimilarity: ssim,
    silhouetteIoU,
    change,
  }
}
