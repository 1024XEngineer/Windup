import type { CSSProperties } from 'react'

import './kinetic-copy.css'

export type KineticCopyPhase = 'entering' | 'resting' | 'exiting'

export type KineticCopyProps = {
  lines: readonly [string, string]
  copyKey: string
  phase: KineticCopyPhase
}

export function KineticCopy({ lines, copyKey, phase }: KineticCopyProps) {
  return (
    <div
      key={copyKey}
      data-copy-phase={phase}
      className={`auth-copy-cycle auth-copy-cycle-${phase}`}
      aria-hidden="true"
    >
      {lines.map((line, index) => (
        <span key={line} className="auth-copy-line">
          <span
            className="auth-copy-line-inner"
            style={{ '--auth-line-index': index } as CSSProperties}
          >
            {line}
          </span>
        </span>
      ))}
    </div>
  )
}
