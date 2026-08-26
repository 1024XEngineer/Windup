import type { CSSProperties } from 'react'

import './pixel-matrix.css'

const PIXEL_MATRIX_DOTS = Array.from({ length: 432 }, (_, index) => {
  const column = index % 24
  const row = Math.floor(index / 24)
  const noise = ((column * 37 + row * 61 + index * 17) % 101) / 100
  const wave = (Math.sin(column * 0.72 + row * 0.41) + 1) / 2
  const level = 0.3 + (noise * 0.55 + wave * 0.45) * 0.7
  const delay = Math.round(((column / 23) * 0.48 + (row / 17) * 0.3 + noise * 0.22) * 900)
  return { delay, level: level.toFixed(2) }
})

export function PixelMatrix({ coverage = 'inset' }: { coverage?: 'inset' | 'compact' }) {
  return (
    <div
      data-pixel-matrix-coverage={coverage}
      className={`pixel-matrix ${coverage === 'compact' ? 'pixel-matrix-compact' : ''}`}
      aria-hidden="true"
    >
      {PIXEL_MATRIX_DOTS.map(({ delay, level }, index) => (
        <i
          key={index}
          data-pixel-matrix-dot
          className="pixel-matrix-dot"
          style={
            {
              '--pixel-matrix-delay': `${delay}ms`,
              '--pixel-matrix-level': level,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
