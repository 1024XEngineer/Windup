import { useEffect, useState } from 'react'

const FRAME_DURATION_MS = 1000 / 32
const MAX_FRAME_DELTA_MS = 50

const walkingFrameUrls = Object.entries(
  import.meta.glob<string>('/src/assets/landing/characters/walking-witch/*.webp', {
    eager: true,
    import: 'default',
    query: '?url',
  }),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, url]) => url)

/** 与 PlayTest 一样先预载全部帧，再由 requestAnimationFrame 按累计时长推进。 */
export function WalkingCharacterPreview() {
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    for (const [index, url] of walkingFrameUrls.entries()) {
      const image = new Image()
      image.decoding = 'async'
      image.fetchPriority = index === 0 ? 'high' : 'low'
      image.src = url
      if (typeof image.decode === 'function') void image.decode().catch(() => undefined)
    }

    let animationFrame = 0
    let previousTime: number | null = null
    let frameElapsedMs = 0

    function tick(time: number) {
      if (previousTime !== null) {
        const deltaMs = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, time - previousTime))
        frameElapsedMs += deltaMs
        const framesToAdvance = Math.floor(frameElapsedMs / FRAME_DURATION_MS)
        if (framesToAdvance > 0) {
          frameElapsedMs -= framesToAdvance * FRAME_DURATION_MS
          setFrameIndex((current) => (current + framesToAdvance) % walkingFrameUrls.length)
        }
      }
      previousTime = time
      animationFrame = window.requestAnimationFrame(tick)
    }

    animationFrame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [])

  return (
    <img
      src={walkingFrameUrls[frameIndex]}
      alt="紫灰卷发女巫向前行走"
      className="mx-auto aspect-square w-[min(24rem,82vw)] object-contain [image-rendering:pixelated] lg:ml-0"
      loading="lazy"
      decoding="async"
    />
  )
}
