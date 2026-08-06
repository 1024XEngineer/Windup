import { useCallback, useEffect, useRef } from 'react'

import type { PlaytestFrame } from './model'
import type { Facing, StageBounds } from './runtime/runtime'

export interface PlaytestStageProps {
  readonly frame: PlaytestFrame | null
  readonly x: number
  readonly facing: Facing
  readonly onBoundsChange: (bounds: StageBounds) => void
}

export function PlaytestStage({ frame, x, facing, onBoundsChange }: PlaytestStageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const characterRef = useRef<HTMLImageElement>(null)

  const measureBounds = useCallback(() => {
    const stageWidth = stageRef.current?.getBoundingClientRect().width ?? 0
    const characterWidth = characterRef.current?.getBoundingClientRect().width ?? 0
    if (stageWidth <= 0) return

    const limit = Math.max(0, (stageWidth - characterWidth) / 2 - 28)
    onBoundsChange({ minX: -limit, maxX: limit })
  }, [onBoundsChange])

  useEffect(() => {
    measureBounds()
    const stage = stageRef.current
    if (stage === null || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureBounds)
      return () => window.removeEventListener('resize', measureBounds)
    }

    const observer = new ResizeObserver(measureBounds)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [measureBounds])

  return (
    <div
      ref={stageRef}
      role="region"
      aria-label="试玩舞台"
      className="relative h-full min-h-[520px] overflow-hidden rounded-[1.8rem] border border-black/5 bg-[#eee] shadow-[0_24px_70px_rgba(22,29,25,0.12)]"
      style={{
        backgroundImage:
          'linear-gradient(45deg, #ddd 25%, transparent 25%), linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%), linear-gradient(-45deg, transparent 75%, #ddd 75%)',
        backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
        backgroundSize: '24px 24px',
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-45"
        style={{
          backgroundImage: 'radial-gradient(#bfc3c0 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      />
      <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-[#989e99]/45" />

      {frame === null ? (
        <p className="absolute inset-0 grid place-items-center text-xs tracking-[0.16em] text-[#6f746f]">
          暂无可播放帧
        </p>
      ) : (
        <img
          ref={characterRef}
          src={frame.imageUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          onLoad={measureBounds}
          className="pointer-events-none absolute left-1/2 w-[clamp(150px,22vw,256px)] -translate-x-1/2 select-none object-contain [image-rendering:pixelated] drop-shadow-[0_14px_9px_rgba(27,25,20,0.18)] will-change-transform"
          style={{
            bottom: 'calc(50% - 18px)',
            transform: `translate3d(calc(-50% + ${x}px), 0, 0) scaleX(${facing})`,
          }}
        />
      )}
    </div>
  )
}
