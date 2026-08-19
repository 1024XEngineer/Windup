import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'

import characterJourney from '@/assets/landing/illustrations/character-journey.webp'
import gongbiBirdLeft from '@/assets/landing/illustrations/gongbi-tit-flight-up.webp'
import gongbiBirdRight from '@/assets/landing/illustrations/gongbi-tit-flight-down.webp'
import { useAuthSession } from '@/features/auth-session'
import { usePrefersReducedMotion } from '@/shared/hooks'
import { CapabilitiesRail } from './capabilities-rail'
import { MarketingHeader } from './marketing-header'
import './landing-motion.css'

const creationEntry = `/?${new URLSearchParams({
  account: 'login',
  returnTo: '/workspace',
})}`

const productCapabilities = [
  {
    outcome:
      'Windup 把角色、造型、动作和每一帧收进同一个项目资产库。今天确认的角色，明天仍然可以回来增加新的动作，创作不会在一次生成后重新归零。',
    statement: '让角色留下来，而不是生成完就散场。',
    title: '资产库',
  },
  {
    outcome:
      '选择已经完成的角色与造型，就能在浏览器里切换动作、控制移动，亲手感受播放节奏与动作衔接。这里读取的不是演示动画，而是项目里真实保存的动作帧。',
    statement: '让他真正走起来，再决定下一步。',
    title: '预览台',
  },
  {
    outcome:
      '角色母版、动作首帧、生成方式、完整动画和审核，都留在同一张可恢复的工作流画布上。不同动作从同一份角色母版出发，质量不再只靠一次生成碰运气。',
    statement: '同一个角色，在每一个动作里仍然是他自己。',
    title: '工作流画布',
  },
] as const

const assetLevels = [
  ['Project', '项目约束', '题材、画风、视角与精灵尺寸'],
  ['Character', '角色身份', '稳定的人物特征与参考基准'],
  ['Outfit', '角色造型', '一套穿戴与对应角色母版'],
  ['Action', '动作资产', '可审核、可预览、可继续扩展的帧序列'],
] as const

const styleShowcaseItems = [
  {
    placeholder: '此处将展示同一角色的像素动画生成结果。',
    title: '像素动画',
  },
  {
    placeholder: '此处将展示同一角色的手绘逐帧生成结果。',
    title: '手绘逐帧',
  },
  {
    placeholder: '此处将展示同一角色的绘画质感生成结果。',
    title: '绘画质感',
  },
  {
    placeholder: '此处将展示项目自定义风格的生成结果。',
    title: '项目风格',
  },
] as const

const pipelineStages = [
  ['01', '角色约束', '母版与项目风格'],
  ['02', '动作意图', '姿态与节奏目标'],
  ['03', '首帧确认', '先判断，再展开'],
  ['04', '完整动画', '按策略生成'],
  ['05', '审核入库', '留下可继续的资产'],
] as const

const pipelineTradeoffs = [
  ['早期探索', '确认方向可读', '优先缩短等待', '控制投入'],
  ['关键动作', '确认角色一致', '保持制作节奏', '按需投入'],
  ['交付之前', '完成逐帧审核', '为质量让位', '集中投入'],
] as const

const primaryCta =
  'inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-7 text-body font-medium whitespace-nowrap text-paper transition-colors duration-200 hover:bg-accent-deep focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent'

const riseClassName =
  'motion-safe:animate-[landing-rise_560ms_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none'

const floatingCardClassName =
  'absolute top-1/2 left-1/2 overflow-hidden rounded-xl border border-[#dedfda] bg-white shadow-[0_18px_48px_rgb(45_48_44/0.08)] origin-center will-change-[transform,opacity]'

const capabilitySceneClassName =
  'absolute inset-0 flex min-w-0 flex-col overflow-hidden rounded-[inherit] bg-white will-change-[opacity,transform]'

const capabilityMediaNoteClassName =
  'absolute bottom-5 left-5 text-[0.64rem] tracking-[0.01em] text-[#a1a39e]'

const capabilityStoryVariables = {
  '--asset-opacity': 0,
  '--play-opacity': 0,
  '--canvas-opacity': 0,
  '--asset-scale': 0.975,
  '--play-scale': 0.96,
  '--canvas-scale': 0.96,
  '--story-copy-y': 0,
  '--story-copy-scale': 1,
  '--story-stage-opacity': 0,
  '--story-stage-y': '10vh',
  '--story-stage-scale': 0.76,
  '--story-cue-opacity': 1,
} as CSSProperties

/** Hero 各块共用一种入场动作，只通过延迟形成次序。 */
function riseDelay(order: number) {
  return { animationDelay: `${order * 90}ms` }
}

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, value))
}

function easeProgress(value: number) {
  const progress = clampProgress(value)
  return progress * progress * (3 - 2 * progress)
}

function progressBetween(progress: number, start: number, end: number) {
  return easeProgress((progress - start) / (end - start))
}

function AssetLibraryScene() {
  return (
    <div
      className={`${capabilitySceneClassName} [opacity:var(--asset-opacity)] [transform:scale(var(--asset-scale))] motion-reduce:opacity-100 motion-reduce:transform-none`}
    >
      <p className={capabilityMediaNoteClassName}>此处将展示 Windup 资产库的真实界面。</p>
    </div>
  )
}

function PlayTestScene() {
  return (
    <div
      className={`${capabilitySceneClassName} [opacity:var(--play-opacity)] [transform:scale(var(--play-scale))] motion-reduce:hidden`}
    >
      <p className={capabilityMediaNoteClassName}>此处将展示预览台的真实运行画面。</p>
    </div>
  )
}

function WorkflowCanvasScene() {
  return (
    <div
      data-testid="workflow-editor-placeholder"
      className={`${capabilitySceneClassName} [opacity:var(--canvas-opacity)] [transform:scale(var(--canvas-scale))] motion-reduce:hidden`}
    />
  )
}

function CapabilityStory() {
  const storyRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const reduceMotion = usePrefersReducedMotion()
  const activeCapability = productCapabilities[activeIndex]

  useEffect(() => {
    const story = storyRef.current
    if (!story) return

    if (reduceMotion) return

    const artifacts = Array.from(story.querySelectorAll<HTMLElement>('[data-floating-artifact]'))
    let animationFrame = 0
    let currentPhase = -1

    function updateStory() {
      animationFrame = 0
      const bounds = story!.getBoundingClientRect()
      const stickyTop = 72
      const travel = Math.max(bounds.height - (window.innerHeight - stickyTop), 1)
      const progress = clampProgress((stickyTop - bounds.top) / travel)
      const collect = progressBetween(progress, 0.02, 0.3)
      const play = progressBetween(progress, 0.32, 0.44)
      const canvas = progressBetween(progress, 0.64, 0.76)
      const handoff = progressBetween(progress, 0.92, 1)
      const phase = progress < 0.38 ? 0 : progress < 0.7 ? 1 : 2
      const assetOpacity = Math.min(1, collect * 1.35) * (1 - play)
      const playOpacity = play * (1 - canvas)

      story!.style.setProperty('--story-copy-y', `${collect * -28}vh`)
      story!.style.setProperty('--story-copy-scale', String(1 - collect * 0.13))
      story!.style.setProperty('--story-stage-opacity', String(Math.min(1, collect * 1.35)))
      story!.style.setProperty('--story-stage-y', `${(1 - collect) * 10 - handoff * 8}vh`)
      story!.style.setProperty(
        '--story-stage-scale',
        String(0.76 + collect * 0.24 - handoff * 0.04),
      )
      story!.style.setProperty('--story-cue-opacity', String(Math.max(0, 1 - collect * 2.2)))
      story!.style.setProperty('--asset-opacity', assetOpacity.toFixed(4))
      story!.style.setProperty('--play-opacity', playOpacity.toFixed(4))
      story!.style.setProperty('--canvas-opacity', canvas.toFixed(4))
      story!.style.setProperty('--asset-scale', String(0.975 + assetOpacity * 0.025))
      story!.style.setProperty('--play-scale', String(0.96 + playOpacity * 0.04))
      story!.style.setProperty('--canvas-scale', String(0.96 + canvas * 0.04))

      artifacts.forEach((artifact) => {
        const x = Number(artifact.dataset.x ?? 0) * (1 - collect)
        const y = Number(artifact.dataset.y ?? 0) * (1 - collect)
        const rotate = Number(artifact.dataset.rotate ?? 0) * (1 - collect)
        const scale = 0.72 + 0.28 * (1 - collect)
        artifact.style.transform = `translate3d(calc(-50% + ${x}vw), calc(-50% + ${y}vh), 0) rotate(${rotate}deg) scale(${scale})`
        artifact.style.opacity = String(Math.max(0, 1 - collect * 1.18))
      })

      if (phase !== currentPhase) {
        currentPhase = phase
        setActiveIndex(phase)
      }
    }

    function scheduleStoryUpdate() {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(updateStory)
    }

    updateStory()
    window.addEventListener('scroll', scheduleStoryUpdate, { passive: true })
    window.addEventListener('resize', scheduleStoryUpdate)

    return () => {
      window.removeEventListener('scroll', scheduleStoryUpdate)
      window.removeEventListener('resize', scheduleStoryUpdate)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [reduceMotion])

  return (
    <div
      ref={storyRef}
      className="relative h-[calc(100vh_+_2500px)] motion-reduce:h-auto motion-reduce:min-h-[58rem]"
      style={capabilityStoryVariables}
    >
      <div className="sticky top-[4.5rem] isolate h-[calc(100vh_-_4.5rem)] min-h-[43rem] overflow-hidden [background:radial-gradient(circle_at_16%_24%,rgb(201_207_194/0.38),transparent_24%),radial-gradient(circle_at_82%_78%,rgb(205_195_178/0.3),transparent_22%),var(--color-paper-sunken)] motion-reduce:relative motion-reduce:top-auto motion-reduce:h-[58rem]">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 opacity-[0.35] [background-image:radial-gradient(circle,rgb(82_92_82/0.22)_0.7px,transparent_0.8px)] [background-size:24px_24px] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]"
        />

        <header className="absolute top-[47%] left-1/2 z-[4] w-[min(90vw,64rem)] origin-center [transform:translate(-50%,-50%)_translateY(var(--story-copy-y))_scale(var(--story-copy-scale))] text-center will-change-transform motion-reduce:top-32 motion-reduce:[transform:translateX(-50%)]">
          <p className="font-mono text-meta text-ink-faint">A CHARACTER, THROUGH WINDUP</p>
          <h2 className="mt-5 text-display text-ink">角色不只被生成一次。</h2>
          <div
            key={activeCapability.title}
            role="status"
            aria-live="polite"
            className="mt-5 min-h-30 motion-safe:animate-[capability-copy-in_280ms_cubic-bezier(0.16,1,0.3,1)_both]"
          >
            <p className="font-serif text-subtitle text-ink">{activeCapability.statement}</p>
            <p className="mx-auto mt-2 max-w-[32rem] text-body text-ink-muted">
              {activeCapability.outcome}
            </p>
          </div>
        </header>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[2] motion-reduce:hidden"
        >
          <article
            data-floating-artifact
            data-x="-39"
            data-y="-13"
            data-rotate="-4"
            className={`${floatingCardClassName} h-36 w-52`}
          >
            <p className="absolute bottom-[0.9rem] left-[0.9rem] text-[0.6rem] text-[#9b9e98]">
              角色档案素材待接入
            </p>
          </article>
          <article
            data-floating-artifact
            data-x="36"
            data-y="-20"
            data-rotate="3"
            className={`${floatingCardClassName} h-40 w-44`}
          >
            <p className="absolute bottom-[0.9rem] left-[0.9rem] text-[0.6rem] text-[#9b9e98]">
              角色母版素材待接入
            </p>
          </article>
          <article
            data-floating-artifact
            data-x="-28"
            data-y="29"
            data-rotate="2"
            className={`${floatingCardClassName} h-28 w-72`}
          >
            <p className="absolute bottom-[0.9rem] left-[0.9rem] text-[0.6rem] text-[#9b9e98]">
              动作序列素材待接入
            </p>
          </article>
          <article
            data-floating-artifact
            data-x="36"
            data-y="23"
            data-rotate="-3"
            className={`${floatingCardClassName} h-32 w-56`}
          >
            <p className="absolute bottom-[0.9rem] left-[0.9rem] text-[0.6rem] text-[#9b9e98]">
              预览台画面待接入
            </p>
          </article>
        </div>

        <div className="absolute top-[61%] left-1/2 z-[3] h-[min(50vh,32rem)] min-h-[27rem] w-[min(72vw,68rem)] origin-center overflow-hidden rounded-xl bg-white [opacity:var(--story-stage-opacity)] [transform:translate(-50%,-50%)_translateY(var(--story-stage-y))_scale(var(--story-stage-scale))] will-change-[transform,opacity] motion-reduce:opacity-100 motion-reduce:[transform:translate(-50%,-50%)]">
          <AssetLibraryScene />
          <PlayTestScene />
          <WorkflowCanvasScene />
        </div>

        <ol
          className="absolute right-12 bottom-8 left-12 z-[5] grid grid-cols-3 border-t border-[rgb(89_98_89/0.24)]"
          aria-label="角色经过 Windup 的三个阶段"
        >
          {productCapabilities.map((capability, index) => (
            <li
              key={capability.title}
              className={`relative flex gap-[0.7rem] pt-[0.8rem] text-[0.7rem] transition-colors duration-[180ms] ease-out ${
                index === activeIndex ? 'text-[#273028]' : 'text-[#777e76]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute -top-px inset-x-0 h-px origin-left bg-[#555b54] [transition:opacity_180ms_ease-out,transform_260ms_cubic-bezier(0.16,1,0.3,1)] ${
                  index === activeIndex ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0'
                }`}
              />
              <span className="font-mono tracking-[0.08em]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <strong className="font-semibold">{capability.title}</strong>
            </li>
          ))}
        </ol>

        <p className="absolute bottom-[5.2rem] left-1/2 z-[5] -translate-x-1/2 [opacity:var(--story-cue-opacity)] font-mono text-meta text-ink-faint motion-reduce:hidden">
          SCROLL TO FOLLOW THE CHARACTER ↓
        </p>
      </div>
    </div>
  )
}

function StyleGenerationShowcase() {
  const reduceMotion = usePrefersReducedMotion()
  const [activeStyle, setActiveStyle] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    if (reduceMotion || isPaused) return

    const interval = window.setInterval(() => {
      setActiveStyle((current) => (current + 1) % styleShowcaseItems.length)
    }, 2800)

    return () => window.clearInterval(interval)
  }, [isPaused, reduceMotion])

  const activeItem = styleShowcaseItems[activeStyle]

  return (
    <section id="styles" className="border-b border-rule bg-paper px-12 py-32">
      <div className="mx-auto grid max-w-[82rem] grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.72fr)] items-center gap-20">
        <figure
          className="min-w-0"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          <div
            className="relative aspect-[1.32] overflow-hidden rounded-xl bg-white"
            aria-label={`${activeItem.title}素材展示位`}
          >
            <p
              key={activeItem.title}
              className="absolute bottom-5 left-5 text-[0.64rem] tracking-[0.01em] text-[#a1a39e] motion-safe:animate-[capability-copy-in_220ms_cubic-bezier(0,0,0.2,1)_both]"
            >
              {activeItem.placeholder}
            </p>
          </div>
        </figure>

        <div className="max-w-[28rem]">
          <p className="font-mono text-meta text-ink-faint">FULL-STYLE GENERATION</p>
          <h2 className="mt-6 text-display text-ink">同一个角色，可以属于不同的画面。</h2>
          <p className="mt-8 text-lead text-ink-muted">
            Windup
            不把角色锁进一种固定画法。从像素、手绘到项目自己的完整风格，角色母版、造型与动作仍沿着同一份资产结构继续生长。
          </p>
          <p className="mt-8 border-l border-spark pl-5 font-serif text-subtitle text-ink">
            改变画面的语言，不丢掉角色的来路。
          </p>
        </div>
      </div>
    </section>
  )
}

function GenerationPipeline() {
  return (
    <section id="pipeline" className="border-b border-rule bg-[#f1f1ee] px-12 py-32">
      <div className="mx-auto max-w-[82rem]">
        <div className="grid grid-cols-[minmax(0,0.72fr)_minmax(30rem,1.28fr)] items-end gap-20">
          <div>
            <p className="font-mono text-meta text-ink-faint">GENERATION STRATEGY</p>
            <h2 className="mt-6 max-w-[8em] text-display text-ink">
              不是每一步，都值得付出同样的代价。
            </h2>
          </div>
          <div className="pb-2">
            <p className="max-w-[37rem] text-lead text-ink-muted">
              探索时先快一点，确认后再把资源交给质量。Windup
              让角色约束、生成策略与审核结果留在同一条管线上，团队看得见每一次取舍发生在哪里。
            </p>
            <p className="mt-5 font-mono text-meta text-ink-faint">
              下方为策略关系示意，不代表实测耗时或成本数据。
            </p>
          </div>
        </div>

        <div className="mt-16 overflow-hidden rounded-xl bg-white">
          <ol className="grid grid-cols-5" aria-label="角色生成管线">
            {pipelineStages.map(([number, title, detail], index) => (
              <li
                key={title}
                className={`min-h-[11.5rem] px-6 py-8 ${
                  index === pipelineStages.length - 1 ? '' : 'border-r border-[#e5e5e1]'
                }`}
              >
                <span className="font-mono text-[0.62rem] tracking-[0.1em] text-[#8a8d87]">
                  {number}
                </span>
                <strong className="mt-[2.4rem] block text-[0.9rem] font-semibold text-[#242724]">
                  {title}
                </strong>
                <small className="mt-[0.55rem] block text-[0.66rem] text-[#737771]">{detail}</small>
              </li>
            ))}
          </ol>

          <div className="border-t border-[#dedfda]" role="table" aria-label="不同制作阶段的取舍">
            <div role="row" className="grid grid-cols-[1.15fr_repeat(3,1fr)] bg-[#f7f7f5]">
              {['制作阶段', '质量', '效率', '资源投入'].map((heading, index) => (
                <span
                  key={heading}
                  role="columnheader"
                  className={`min-h-[3.6rem] px-6 py-[1.15rem] font-mono text-[0.58rem] font-normal tracking-[0.08em] text-[#888b85] ${
                    index === 3 ? '' : 'border-r border-[#ededeb]'
                  }`}
                >
                  {heading}
                </span>
              ))}
            </div>
            {pipelineTradeoffs.map(([stage, quality, efficiency, cost]) => (
              <div
                key={stage}
                role="row"
                className="grid grid-cols-[1.15fr_repeat(3,1fr)] border-t border-[#ededeb]"
              >
                <strong
                  role="cell"
                  className="min-h-[3.6rem] border-r border-[#ededeb] px-6 py-[1.15rem] text-[0.7rem] font-semibold text-[#252825]"
                >
                  {stage}
                </strong>
                {[quality, efficiency, cost].map((value, index) => (
                  <span
                    key={value}
                    role="cell"
                    className={`min-h-[3.6rem] px-6 py-[1.15rem] text-[0.7rem] font-normal text-[#5f635d] ${
                      index === 2 ? '' : 'border-r border-[#ededeb]'
                    }`}
                  >
                    {value}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/** 面向访客的完整宣传页，不读取任何受保护业务数据。 */
export function LandingPage() {
  const session = useAuthSession()
  const startPath = session.state.status === 'guest' ? creationEntry : '/workspace'

  return (
    <div className="landing-page min-h-[100dvh] bg-paper text-ink">
      <MarketingHeader />

      <main>
        <section
          aria-label="Windup 首屏"
          className="relative isolate min-h-[calc(80dvh_-_4.5rem_+_min(40vw,_36rem))] overflow-hidden border-b border-[#d8d6ce] text-[#252520] [background:linear-gradient(180deg,rgb(247_246_240/0.82),rgb(237_239_231/0.92)),#f2f1ea]"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 [background:radial-gradient(circle_at_14%_58%,rgb(199_207_193/0.34),transparent_25%),radial-gradient(circle_at_88%_22%,rgb(204_196_178/0.3),transparent_23%)]"
          />
          <img
            src={gongbiBirdLeft}
            alt=""
            aria-hidden="true"
            data-testid="hero-bird-left"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="pointer-events-none absolute top-[18.75rem] -left-24 z-[1] block h-auto w-[min(34vw,31rem)] rotate-[2deg] select-none"
          />
          <img
            src={gongbiBirdRight}
            alt=""
            aria-hidden="true"
            data-testid="hero-bird-right"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="pointer-events-none absolute top-21 -right-[9.5rem] z-[1] block h-auto w-[min(32vw,29rem)] -rotate-[4deg] select-none"
          />

          <div className="relative z-10 mx-auto flex w-full max-w-[82rem] flex-col items-center px-12 pt-20 text-center">
            <p
              className={`${riseClassName} mx-auto w-full text-[0.875rem] leading-6 font-medium tracking-[0.04em] text-[#696861]`}
              style={riseDelay(0)}
            >
              从角色设定到可玩的 2D 动作资产
            </p>
            <h1
              className={`${riseClassName} mx-auto mt-5 w-full max-w-[11em] font-['Songti_SC','Noto_Serif_CJK_SC','STSong',Georgia,serif] text-[clamp(4rem,5.5vw,5.25rem)] leading-[1.12] font-semibold tracking-[-0.055em] text-[#23231f]`}
              style={riseDelay(1)}
            >
              <span className="block">让你的角色，</span>
              <span className="block">真正登场。</span>
            </h1>
            <p
              className={`${riseClassName} mx-auto mt-6 w-full max-w-[31rem] text-[1.0625rem] leading-8 text-[#5d5c56]`}
              style={riseDelay(2)}
            >
              用一条可审核的工作流，生成并管理保持一致的 2D 角色动作。
            </p>
            <Link
              to={startPath}
              className={`${riseClassName} mx-auto mt-8 inline-flex min-h-12 items-center justify-center rounded-lg bg-[#252520] px-7 text-[0.9375rem] font-medium whitespace-nowrap text-[#f7f5ee] transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#3a3b36] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3a3b36] active:translate-y-px`}
              style={riseDelay(3)}
            >
              开始创作
            </Link>
          </div>

          <figure className="absolute top-[calc(80dvh_-_4.5rem)] left-1/2 z-20 w-[80%] max-w-[72rem] -translate-x-1/2 transform-gpu">
            <div
              data-testid="workflow-editor-placeholder"
              className="aspect-[2/1] overflow-hidden rounded-2xl border border-[#c9c8c0] bg-[#f9f8f3] shadow-[0_30px_80px_rgba(53,58,49,0.18)]"
            />
          </figure>
        </section>

        <CapabilitiesRail />

        <section id="workflow" className="scroll-mt-20 border-b border-rule bg-paper-sunken">
          <CapabilityStory />
        </section>

        <StyleGenerationShowcase />

        <GenerationPipeline />

        <section className="border-b border-rule px-8 py-28 lg:px-12">
          <div className="mx-auto grid max-w-[82rem] gap-16 lg:grid-cols-[minmax(18rem,0.5fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <h2 className="max-w-[7.4em] text-title text-ink">同一份创作，两种进入方式。</h2>
              <dl className="mt-12 grid gap-8">
                <div className="border-t border-rule pt-6">
                  <dt className="text-subtitle font-semibold text-ink">Quick Start</dt>
                  <dd className="mt-3 max-w-[26em] text-body text-ink-muted">
                    用自然语言描述角色和动作，系统建立标准流程，并在需要判断的地方停下来等你确认。
                  </dd>
                </div>
                <div className="border-t border-rule pt-6">
                  <dt className="text-subtitle font-semibold text-ink">Workflow Editor</dt>
                  <dd className="mt-3 max-w-[26em] text-body text-ink-muted">
                    打开同一条
                    WorkflowRun，看清角色母版、动作首帧、完整动画和审核状态，再继续新的动作。
                  </dd>
                </div>
              </dl>
            </div>

            <figure>
              <div
                data-testid="workflow-editor-placeholder"
                className="aspect-[16/10] overflow-hidden rounded-xl border border-rule bg-paper-sunken"
              />
              <figcaption className="mt-4 text-body text-ink-faint">
                真实 WorkflowRun 会保留画布中的每一次确认结果。
              </figcaption>
            </figure>
          </div>
        </section>

        <section id="workspace" className="scroll-mt-28 px-8 py-28 lg:px-12">
          <div className="mx-auto grid max-w-[82rem] gap-16 lg:grid-cols-[minmax(18rem,0.5fr)_minmax(0,1fr)]">
            <div>
              <h2 className="max-w-[7.4em] text-title text-ink">资产会留下来，继续生长。</h2>
              <p className="mt-6 max-w-[22em] text-lead text-ink-muted">
                今天确认的角色，明天可以回来补动作。每套造型、每个动作和每一帧都归在同一个项目里。
              </p>
            </div>

            {/*
              四层资产是包含关系，不是四张并列的卡。用逐级缩进加左侧竖线直接把
              Project ⊃ Character ⊃ Outfit ⊃ Action 画出来——早先四张等大的卡片
              占了两屏多，却没有任何东西说明它们谁装着谁。
            */}
            <ol aria-label="Windup 资产层级" className="grid gap-3">
              {assetLevels.map(([name, title, detail], index) => (
                <li key={name} style={{ paddingInlineStart: `${index * 2.5}rem` }}>
                  <article className="grid grid-cols-[8rem_1fr] items-baseline gap-6 rounded-xl border-l-2 border-rule bg-paper-raised py-6 pr-8 pl-7 transition-colors duration-200 hover:border-spark">
                    <span className="font-mono text-meta text-ink-faint">{name}</span>
                    <span>
                      <strong className="block text-subtitle font-semibold text-ink">
                        {title}
                      </strong>
                      <small className="mt-1.5 block text-body text-ink-muted">{detail}</small>
                    </span>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/*
          收尾块：块高由图自己定，不由文案定。源图 1536×1024 里有像素的是 y 224–795，
          aspect 1536/571 + 49% 取到的就是这一整段——云顶不切、底边压在画面最后一排
          像素上。反过来让文案撑高度的话，窗口高度跟着 padding 走，云一定会被切掉。
          文案绝对定位浮在上半部分那片天空里，不参与块高。
        */}
        <div className="relative isolate">
          <img
            src={characterJourney}
            alt="同一批角色从线稿逐步走到成品，最后站进游戏场景里"
            loading="lazy"
            decoding="async"
            className="block aspect-[1536/571] w-full object-cover object-[center_49%]"
          />

          <div className="absolute inset-x-0 top-0 px-8 pt-14 lg:px-12">
            <div className="mx-auto max-w-[82rem]">
              <h2 className="max-w-[8.4em] text-display text-ink">从一个角色开始。</h2>
              <p className="mt-5 max-w-[22em] text-lead text-ink-muted">
                写下设定，确认母版，让第一组动作进入项目资产库，并在浏览器里真正跑起来。
              </p>
              <Link to={startPath} className={`${primaryCta} mt-8`}>
                开始创作
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
