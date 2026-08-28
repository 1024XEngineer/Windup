import { useEffect, useRef } from 'react'

import workflowDemoPoster from '@/assets/landing/workflow-demo/workflow-editor-demo-poster.webp'
import workflowDemoVideo from '@/assets/landing/workflow-demo/workflow-editor-demo.mp4'
import workflowEditorProductionVideo from '@/assets/landing/workflow-editor/workflow-editor-production.mp4'

/** 视频只在用户真正看到这一段时播放，离开视口后立即暂停。 */
interface WorkflowDemoVideoProps {
  source?: string
  label?: string
}

export function WorkflowDemoVideo({
  source = workflowDemoVideo,
  label = 'Workflow Editor 实际运行演示',
}: WorkflowDemoVideoProps = {}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.35) {
          void video.play().catch(() => undefined)
          return
        }
        video.pause()
      },
      { threshold: 0.35 },
    )
    observer.observe(video)

    return () => {
      observer.disconnect()
      video.pause()
    }
  }, [])

  return (
    <div className="overflow-hidden rounded-[1.25rem] shadow-[0_36px_96px_rgba(35,38,31,0.24),0_12px_28px_rgba(35,38,31,0.12)]">
      <video
        ref={videoRef}
        src={source}
        poster={workflowDemoPoster}
        aria-label={label}
        className="block aspect-[1918/1080] w-full object-contain"
        muted
        loop
        playsInline
        preload="metadata"
      />
    </div>
  )
}

export function WorkflowEditorProductionVideo() {
  return (
    <WorkflowDemoVideo source={workflowEditorProductionVideo} label="Workflow Editor 生产演示" />
  )
}
