import { useCallback, useEffect, useRef, useState } from 'react'

import type { PreviewFrame } from './model/types'
import type { HorizontalStageBounds, StageOffset } from './stage-motion'

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const
const DEFAULT_ZOOM = 4 // 64px sprite at 4x = 256px on screen
/** 高分辨率精灵(>=192px)首次加载时用 1x,避免 256px 素材被默认放大到 1024px。 */
const HIGH_RES_ZOOM = 1
const HIGH_RES_THRESHOLD_PX = 192

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
  const [zoomIndex, setZoomIndex] = useState(() => ZOOM_LEVELS.indexOf(DEFAULT_ZOOM))
  const stageRef = useRef<HTMLElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const zoom = ZOOM_LEVELS[zoomIndex] ?? DEFAULT_ZOOM
  const zoomIn = useCallback(() => {
    setZoomIndex((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1))
  }, [])
  const zoomOut = useCallback(() => {
    setZoomIndex((i) => Math.max(i - 1, 0))
  }, [])
  const resetZoom = useCallback(() => {
    setZoomIndex(ZOOM_LEVELS.indexOf(DEFAULT_ZOOM))
  }, [])

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

  // Mouse wheel zoom on stage
  useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoomIndex((i) => {
        if (e.deltaY < 0) return Math.min(i + 1, ZOOM_LEVELS.length - 1)
        if (e.deltaY > 0) return Math.max(i - 1, 0)
        return i
      })
    }
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [])

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
          onLoad={(event) => {
            reportHorizontalBounds()
            if (event.currentTarget.naturalWidth >= HIGH_RES_THRESHOLD_PX) {
              setZoomIndex(ZOOM_LEVELS.indexOf(HIGH_RES_ZOOM))
            }
          }}
          onError={() => setFailedImageUrl(currentFrame.imageUrl)}
          style={{
            transform: `translate(${motionOffset.x}px, ${-motionOffset.y}px) scaleX(${mirrored ? -1 : 1}) scale(${zoom})`,
          }}
          className="relative z-10 max-h-[68%] max-w-[68%] object-contain drop-shadow-[0_18px_12px_rgba(15,23,42,0.12)] [image-rendering:pixelated]"
        />
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-slate-300 bg-white/90 px-1.5 py-1 text-xs shadow-sm">
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoomIndex <= 0}
          className="grid h-6 w-6 place-items-center rounded font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30"
          aria-label="缩小"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetZoom}
          className="min-w-[3rem] rounded px-1 text-center font-mono text-slate-700 hover:bg-slate-100"
          aria-label="重置缩放"
        >
          {zoom * 100}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
          className="grid h-6 w-6 place-items-center rounded font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30"
          aria-label="放大"
        >
          +
        </button>
      </div>
    </section>
  )
}
