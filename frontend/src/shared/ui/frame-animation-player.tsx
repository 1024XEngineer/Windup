import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'

const DEFAULT_FRAME_DURATION_MS = 100

export interface FrameAnimationFrame {
  readonly index: number
  readonly imageUrl: string
  readonly durationMs: number | null
}

export interface FrameAnimationPlayerProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'alt' | 'src'
> {
  readonly frames: readonly FrameAnimationFrame[]
  readonly alt: string
  readonly fps?: number
  readonly loop?: boolean
}

interface PlaybackFrame {
  readonly imageUrl: string
  readonly durationMs: number
}

function fallbackDurationMs(fps: number | undefined): number {
  if (fps !== undefined && Number.isFinite(fps) && fps > 0) {
    return Math.max(1, Math.round(1000 / fps))
  }
  return DEFAULT_FRAME_DURATION_MS
}

function prepareFrames(
  frames: readonly FrameAnimationFrame[],
  fps: number | undefined,
): readonly PlaybackFrame[] {
  const fallback = fallbackDurationMs(fps)
  return [...frames]
    .sort((left, right) => left.index - right.index)
    .map((frame) => ({
      imageUrl: frame.imageUrl,
      durationMs:
        frame.durationMs !== null && Number.isFinite(frame.durationMs) && frame.durationMs > 0
          ? Math.max(1, frame.durationMs)
          : fallback,
    }))
}

export function FrameAnimationPlayer({
  frames,
  alt,
  fps,
  loop = true,
  ...imageProps
}: FrameAnimationPlayerProps) {
  const playbackFrames = prepareFrames(frames, fps)
  const sequenceKey = JSON.stringify(playbackFrames)
  const latestFrames = useRef(playbackFrames)
  latestFrames.current = playbackFrames
  const [playback, setPlayback] = useState({ sequenceKey, index: 0 })
  const sequenceChanged = playback.sequenceKey !== sequenceKey
  const frameIndex = sequenceChanged ? 0 : Math.min(playback.index, playbackFrames.length - 1)
  const frame = playbackFrames[frameIndex]

  useEffect(() => {
    const activeFrames = latestFrames.current
    setPlayback({ sequenceKey, index: 0 })
    if (activeFrames.length < 2) return

    let currentIndex = 0
    let timer: ReturnType<typeof setTimeout>
    const scheduleNextFrame = () => {
      timer = setTimeout(() => {
        const lastFrameIndex = activeFrames.length - 1
        if (!loop && currentIndex === lastFrameIndex) return

        currentIndex = (currentIndex + 1) % activeFrames.length
        setPlayback({ sequenceKey, index: currentIndex })
        scheduleNextFrame()
      }, activeFrames[currentIndex]!.durationMs)
    }

    scheduleNextFrame()
    return () => clearTimeout(timer)
  }, [loop, sequenceKey])

  if (!frame) return null
  return <img {...imageProps} src={frame.imageUrl} alt={alt} />
}
