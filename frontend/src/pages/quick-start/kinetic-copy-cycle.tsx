import { useEffect, useState, type CSSProperties, type ElementType } from 'react'

import './kinetic-copy-cycle.css'

export type KineticCopyMessage =
  | readonly string[]
  | {
      lines: readonly string[]
      prefix?: string
      className?: string
      prefixClassName?: string
    }

export interface KineticCopyCycleProps {
  messages: readonly KineticCopyMessage[]
  active?: boolean
  as?: ElementType
  ariaLabel?: string
  className?: string
  firstCycleMs?: number
  cycleMs?: number
  loopStartIndex?: number
  motionMode?: 'line' | 'characters'
}

type CopyPhase = 'entering' | 'resting' | 'exiting'

const ENTER_DURATION_MS = 760
const EXIT_DURATION_MS = 460
const DEFAULT_CYCLE_MS = 4_200

function messageParts(message: KineticCopyMessage) {
  return Array.isArray(message)
    ? { lines: message as readonly string[] }
    : (message as Exclude<KineticCopyMessage, readonly string[]>)
}

/** Quick Start 的裁切字幕：完整退场后再换文案，避免重叠与跳字。 */
export function KineticCopyCycle({
  messages,
  active = true,
  as: Tag = 'div',
  ariaLabel,
  className = '',
  firstCycleMs = DEFAULT_CYCLE_MS,
  cycleMs = DEFAULT_CYCLE_MS,
  loopStartIndex = 0,
  motionMode = 'line',
}: KineticCopyCycleProps) {
  const [renderedMessages, setRenderedMessages] = useState(messages)
  const [copyIndex, setCopyIndex] = useState(0)
  const [phase, setPhase] = useState<CopyPhase>('entering')

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (messages === renderedMessages) return

    if (!active || reduceMotion) {
      setRenderedMessages(messages)
      setCopyIndex(0)
      setPhase('resting')
      return
    }

    setPhase('exiting')
    const replacementTimer = window.setTimeout(() => {
      setRenderedMessages(messages)
      setCopyIndex(0)
      setPhase('entering')
    }, EXIT_DURATION_MS)

    return () => window.clearTimeout(replacementTimer)
  }, [active, messages, renderedMessages])

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (messages !== renderedMessages) return

    setCopyIndex(0)
    setPhase(active && !reduceMotion ? 'entering' : 'resting')
    if (!active || reduceMotion || renderedMessages.length < 2) return

    let exitTimer: number | null = null
    let swapTimer: number | null = null
    let restTimer: number | null = window.setTimeout(() => setPhase('resting'), ENTER_DURATION_MS)

    const scheduleExit = (delay: number) => {
      exitTimer = window.setTimeout(() => {
        setPhase('exiting')
        swapTimer = window.setTimeout(() => {
          setCopyIndex((current) =>
            current + 1 < renderedMessages.length ? current + 1 : loopStartIndex,
          )
          setPhase('entering')
          restTimer = window.setTimeout(() => setPhase('resting'), ENTER_DURATION_MS)
          scheduleExit(Math.max(0, cycleMs - EXIT_DURATION_MS))
        }, EXIT_DURATION_MS)
      }, delay)
    }

    scheduleExit(firstCycleMs)

    return () => {
      if (exitTimer !== null) window.clearTimeout(exitTimer)
      if (swapTimer !== null) window.clearTimeout(swapTimer)
      if (restTimer !== null) window.clearTimeout(restTimer)
    }
  }, [active, cycleMs, firstCycleMs, loopStartIndex, messages, renderedMessages])

  if (renderedMessages.length === 0) return null

  const message = messageParts(renderedMessages[copyIndex % renderedMessages.length])

  return (
    <Tag
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      data-copy-index={copyIndex}
      data-copy-phase={phase}
      data-copy-motion-mode={motionMode}
      className={`kinetic-copy-cycle kinetic-copy-cycle-${phase} ${className}`}
    >
      {message.lines.map((line, lineIndex) => (
        <span key={`${copyIndex}-${line}`} className="kinetic-copy-line">
          <span
            className={`kinetic-copy-line-inner ${message.prefix ? 'kinetic-copy-line-inner-prefixed' : ''} ${message.className ?? ''}`}
            style={
              {
                '--kinetic-copy-line-index': lineIndex,
                '--kinetic-copy-line-reverse-index': message.lines.length - lineIndex - 1,
              } as CSSProperties
            }
          >
            {lineIndex === 0 && message.prefix ? (
              <span className={`kinetic-copy-prefix ${message.prefixClassName ?? ''}`}>
                {message.prefix}
              </span>
            ) : null}
            {motionMode === 'characters'
              ? Array.from(line).map((character, characterIndex, characters) => (
                  <span
                    key={`${character}-${characterIndex}`}
                    aria-hidden="true"
                    className="kinetic-copy-character"
                    style={
                      {
                        '--kinetic-copy-character-index': characterIndex,
                        '--kinetic-copy-character-reverse-index':
                          characters.length - characterIndex - 1,
                      } as CSSProperties
                    }
                  >
                    {character === ' ' ? '\u00a0' : character}
                  </span>
                ))
              : line}
          </span>
        </span>
      ))}
    </Tag>
  )
}
