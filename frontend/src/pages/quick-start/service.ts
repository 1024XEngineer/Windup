import type { ActionGenerationMethod } from '@/entities'

export type QuickStartStatus = 'running' | 'review' | 'completed' | 'failed'

/** WorkflowRun 节点图面向 Quick Start 的只读投影，不建立第二套持久化状态机。 */
export interface QuickStartView {
  runId: string
  status: QuickStartStatus
  title: string
  message: string
  completedNodes: number
  totalNodes: number
  /** Quick Start 自动选择的资产生产路线；当前可执行路线为视频裁剪。 */
  generationMethod: ActionGenerationMethod | null
  fps: number
  animationFrames: readonly string[]
}

export interface StartQuickStartInput {
  prompt: string
  actionDescription: string | null
}

export interface PlaytestTarget {
  characterId: string
  outfitId: string
}

/**
 * App 层把 #107 的单 WorkflowRun Controller 装配成此页面用例。
 * Quick Start 只触发自动选择与连续调用。当前自动选择 video-cropping；
 * 3D 转 2D 接口接通后再由实现层改变策略，页面不拥有节点规则、Store 或后端生成实现。
 */
export interface QuickStartService {
  readonly unavailableReason: string | null
  start(input: StartQuickStartInput): Promise<{ runId: string }>
  load(runId: string): Promise<QuickStartView | null>
  subscribe(runId: string, listener: (view: QuickStartView) => void): () => void
  interrupt(runId: string): Promise<void>
  approve(runId: string): Promise<PlaytestTarget>
}

const UNAVAILABLE_REASON = 'Quick Start 的 WorkflowController 装配尚未配置'

export const unavailableQuickStartService: QuickStartService = {
  unavailableReason: UNAVAILABLE_REASON,
  async start() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async load() {
    return null
  },
  subscribe() {
    return () => undefined
  },
  async interrupt() {
    throw new Error(UNAVAILABLE_REASON)
  },
  async approve() {
    throw new Error(UNAVAILABLE_REASON)
  },
}
