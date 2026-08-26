import { KineticCopyCycle, type KineticCopyMessage } from './kinetic-copy-cycle'
import './generation-progress-copy.css'

export type GenerationProgressKind =
  | 'character-template'
  | 'action-first-frame'
  | 'action-full-frame'
  | 'pixel-perfect'

const GENERATION_PROGRESS_MESSAGES: Record<GenerationProgressKind, readonly KineticCopyMessage[]> =
  {
    'character-template': [
      { lines: ['勾勒角色轮廓'] },
      { lines: ['给衣服配颜色'] },
      { lines: ['把发型画清楚'] },
      { lines: ['添上表情'] },
      { lines: ['处理一下光影'] },
      { lines: ['补齐画面细节'] },
    ],
    'action-first-frame': [
      { lines: ['摆好动作姿态'] },
      { lines: ['调整手脚位置'] },
      { lines: ['让重心自然一点'] },
      { lines: ['拉开姿态的区别'] },
      { lines: ['保持角色样子'] },
      { lines: ['补上动作细节'] },
    ],
    'action-full-frame': [
      { lines: ['把动作连起来'] },
      { lines: ['补上中间的变化'] },
      { lines: ['理顺每一帧的节奏'] },
      { lines: ['检查手脚的衔接'] },
      { lines: ['让起落自然一点'] },
      { lines: ['调整动作幅度'] },
    ],
    'pixel-perfect': [
      { lines: ['对齐像素网格'] },
      { lines: ['整理轮廓边缘'] },
      { lines: ['归拢相近颜色'] },
      { lines: ['保留透明边界'] },
      { lines: ['逐帧检查细节'] },
      { lines: ['准备像素版本'] },
    ],
  }

export interface GenerationProgressCopyProps {
  kind: GenerationProgressKind
  label: string
  placement?: 'conversation' | 'node'
  /** pending 时前面还有几单；0 或缺省不展示。 */
  queueAhead?: number
}

/** 同一生成阶段在不同入口共用文案顺序、逐字进入和停留高光。 */
export function GenerationProgressCopy({
  kind,
  label,
  placement = 'conversation',
  queueAhead,
}: GenerationProgressCopyProps) {
  return (
    <div
      data-generation-progress
      data-generation-progress-placement={placement}
      className="generation-progress-slot"
    >
      {typeof queueAhead === 'number' && queueAhead > 0 ? (
        <p role="status" className="m-0 text-center text-sm text-app-muted">
          前面还有 {queueAhead} 单
        </p>
      ) : null}
      <KineticCopyCycle
        active
        ariaLabel={label}
        messages={GENERATION_PROGRESS_MESSAGES[kind]}
        motionMode="characters"
        firstCycleMs={7_540}
        cycleMs={8_000}
        loopStartIndex={0}
        className={`generation-progress-copy generation-progress-copy--${placement} font-serif`}
      />
    </div>
  )
}
