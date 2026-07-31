/** 工作流编辑器类型定义 */

export type WorkflowNodeType =
  | 'source'
  | 'master-gen'
  | 'master'
  | 'walk-key'
  | 'idle-key'
  | 'walk-animation'
  | 'idle-animation'
  | 'publish'

export type NodeStatus = 'idle' | 'locked' | 'ready' | 'generating' | 'review' | 'confirmed'

export interface WorkflowNode {
  id: WorkflowNodeType
  eyebrow: string
  title: string
  x: number
  y: number
  status: NodeStatus
  hasInput: boolean
  hasOutput: boolean
  outputEnabled: boolean
  bodyHtml: string
}

export const ALLOWED_CONNECTIONS: readonly [WorkflowNodeType, WorkflowNodeType][] = [
  ['source', 'master-gen'],
  ['master-gen', 'master'],
  ['master', 'walk-key'],
  ['master', 'idle-key'],
  ['walk-key', 'walk-animation'],
  ['idle-key', 'idle-animation'],
  ['walk-animation', 'publish'],
  ['idle-animation', 'publish'],
]

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  idle: '尚未生成',
  locked: '等待上游',
  ready: '可以生成',
  generating: '生成中',
  review: '等待确认',
  confirmed: '已确认',
}

export const NODE_POSITIONS: Record<WorkflowNodeType, { x: number; y: number }> = {
  source: { x: 70, y: 280 },
  'master-gen': { x: 510, y: 180 },
  master: { x: 950, y: 240 },
  'walk-key': { x: 1390, y: 60 },
  'idle-key': { x: 1390, y: 570 },
  'walk-animation': { x: 1820, y: 60 },
  'idle-animation': { x: 1820, y: 570 },
  publish: { x: 2250, y: 330 },
}
