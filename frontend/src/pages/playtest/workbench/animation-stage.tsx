import { useCallback, useEffect, useRef, useState } from 'react'

import type { PreviewFrame } from './model/types'
import type { HorizontalStageBounds, StageOffset } from './stage-motion'

export interface AnimationStageProps {
  currentFrame: PreviewFrame | null
  /** Accumulated playback position in world coordinates (positive y is up). */
  motionOffset: StageOffset
  mirrored: boolean
  showGrid: boolean
  showChecker: boolean
  onHorizontalBoundsChange?(bounds: HorizontalStageBounds | null): void
}

export function AnimationStage({
  currentFrame,
  motionOffset,
  mirrored,
  showGrid,
  showChecker,
  onHorizontalBoundsChange,
}: AnimationStageProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const stageRef = useRef<HTMLElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const reportHorizontalBounds = useCallback(() => {
    if (onHorizontalBoundsChange === undefined) return
    const stage = stageRef.current
    const image = imageRef.current
    if (stage === null || image === null) {
      onHorizontalBoundsChange(null)
      return
    }

    const stageWidth = stage.getBoundingClientRect().width
    const actorWidth = image.getBoundingClientRect().width
    if (stageWidth <= 0 || actorWidth <= 0) {
      onHorizontalBoundsChange(null)
      return
    }
    const travel = Math.max(0, (stageWidth - actorWidth) / 2)
    onHorizontalBoundsChange({ minX: -travel, maxX: travel })
  }, [onHorizontalBoundsChange])

  useEffect(() => {
    setFailedImageUrl(null)
  }, [currentFrame?.imageUrl])

  useEffect(() => {
    reportHorizontalBounds()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', reportHorizontalBounds)
      return () => window.removeEventListener('resize', reportHorizontalBounds)
    }

    const observer = new ResizeObserver(reportHorizontalBounds)
    if (stageRef.current !== null) observer.observe(stageRef.current)
    if (imageRef.current !== null) observer.observe(imageRef.current)
    return () => observer.disconnect()
  }, [currentFrame?.imageUrl, reportHorizontalBounds])

  const imageFailed = currentFrame !== null && failedImageUrl === currentFrame.imageUrl

  return (
    <section
      ref={stageRef}
      aria-label="动画预览舞台"
      className={`relative grid h-full min-h-[320px] place-items-center overflow-hidden rounded-2xl border border-slate-300 ${
        showChecker
          ? 'bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px]'
          : 'bg-slate-100'
      }`}
    >
      {showGrid ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.055)_1px,transparent_1px)] bg-[length:24px_24px]"
        />
      ) : null}
      <span
        aria-hidden="true"
        className="absolute bottom-[18%] left-[8%] right-[8%] h-px bg-emerald-900/30"
      />
      {currentFrame === null ? (
        <div className="relative z-10 rounded-xl border border-dashed border-slate-400 bg-white/70 p-6 text-center text-sm text-slate-500">
          当前动作没有可播放的帧
        </div>
      ) : imageFailed ? (
        <div
          role="alert"
          className="relative z-10 rounded-xl border border-rose-200 bg-white/90 p-6 text-sm text-rose-700"
        >
          当前帧图片加载失败
        </div>
      ) : (
        <img
          ref={imageRef}
          src={currentFrame.imageUrl}
          alt="角色动画预览"
          onLoad={reportHorizontalBounds}
          onError={() => setFailedImageUrl(currentFrame.imageUrl)}
          style={{
            transform: `translate(${motionOffset.x}px, ${-motionOffset.y}px) scaleX(${mirrored ? -1 : 1})`,
          }}
          className="relative z-10 max-h-[68%] max-w-[68%] object-contain drop-shadow-[0_18px_12px_rgba(15,23,42,0.12)] [image-rendering:pixelated]"
        />
      )}
    </section>
  )
}
