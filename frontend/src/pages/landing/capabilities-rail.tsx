import { useEffect, useRef } from 'react'

import { usePrefersReducedMotion } from '@/shared/hooks'
import { calculateCapabilitiesRailProgress } from './capabilities-rail-model'

const capabilities = [
  {
    statement: '让角色留下来，而不是生成完就散场。',
    title: '资产库',
  },
  {
    statement: '让他真正走起来，再决定下一步。',
    title: 'PlayTest',
  },
  {
    statement: '同一个角色，在每一个动作里仍然是他自己。',
    title: '工作流画布',
  },
] as const

/** 把页面纵向滚动映射到一条横向能力轨道，内容本身仍按文档顺序保持可访问。 */
export function CapabilitiesRail() {
  const sectionRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const reduceMotion = usePrefersReducedMotion()

  useEffect(() => {
    const section = sectionRef.current
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!section || !viewport || !track || reduceMotion) return

    let animationFrame = 0

    function updateRail() {
      animationFrame = 0
      const bounds = section!.getBoundingClientRect()
      const progress = calculateCapabilitiesRailProgress({
        sectionHeight: bounds.height,
        sectionTop: bounds.top,
        viewportHeight: window.innerHeight,
      })
      const availableTravel = Math.max(track!.scrollWidth - viewport!.clientWidth, 0)
      const travel = Math.min(availableTravel, viewport!.clientWidth * 0.72)

      track!.style.transform = `translate3d(${-travel * progress}px, 0, 0)`
    }

    function scheduleUpdate() {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(updateRail)
    }

    updateRail()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [reduceMotion])

  return (
    <section
      ref={sectionRef}
      id="capabilities"
      aria-labelledby="capabilities-heading"
      className="landing-capabilities-section relative overflow-hidden scroll-mt-28 border-b border-rule pt-28"
    >
      <div className="mx-auto w-full max-w-[82rem] px-8 lg:px-12">
        <h2 id="capabilities-heading" className="max-w-[7.4em] text-display text-ink">
          角色做出来，还要留下来、跑起来。
        </h2>
        <p className="mt-6 max-w-[28em] text-lead text-ink-muted">
          资产库保存角色的全部来路，PlayTest 检验动作真正的样子，工作流画布让质量不靠一次碰运气。
        </p>
      </div>

      <div
        ref={viewportRef}
        className="landing-capabilities-viewport mt-14 overflow-hidden border-y border-rule bg-paper-sunken"
      >
        <div
          ref={trackRef}
          role="list"
          aria-label="产品能力横向滚动"
          className="landing-capabilities-track flex w-max items-center px-[5vw] py-8 will-change-transform"
        >
          {capabilities.map(({ statement, title }) => (
            <article
              key={title}
              role="listitem"
              className="landing-capability-item group flex shrink-0 items-baseline gap-7 border-r border-rule px-14 first:pl-0 last:border-r-0"
            >
              <h3 className="font-mono text-meta whitespace-nowrap text-ink-faint transition-colors duration-200 group-hover:text-spark">
                {title}
              </h3>
              <strong className="font-serif text-subtitle font-medium whitespace-nowrap text-ink-muted transition-colors duration-200 group-hover:text-ink">
                {statement}
              </strong>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
