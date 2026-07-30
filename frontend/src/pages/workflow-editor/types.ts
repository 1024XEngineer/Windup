/** 工作流编辑器类型定义 — 与 asset-lab 的 node-canvas.js 保持一致 */

export type WorkflowNodeType =
  | 'project'
  | 'source'
  | 'master-gen'
  | 'master'
  | 'walk-key'
  | 'idle-key'
  | 'custom-action'
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
}

export interface NodeConnection {
  from: WorkflowNodeType
  to: WorkflowNodeType
}

/** 与 asset-lab node-canvas.js 的 allowedNodeConnections 一致 */
export const ALLOWED_CONNECTIONS: readonly NodeConnection[] = [
  { from: 'project', to: 'source' },
  { from: 'source', to: 'master-gen' },
  { from: 'master-gen', to: 'master' },
  { from: 'master', to: 'walk-key' },
  { from: 'master', to: 'idle-key' },
  { from: 'master', to: 'custom-action' },
  { from: 'walk-key', to: 'walk-animation' },
  { from: 'idle-key', to: 'idle-animation' },
  { from: 'walk-animation', to: 'publish' },
  { from: 'idle-animation', to: 'publish' },
]

export const INITIAL_NODES: WorkflowNode[] = [
  { id: 'project', eyebrow: '01 · PROJECT', title: '项目信息', x: 70, y: 60, status: 'confirmed', hasInput: false, hasOutput: true, outputEnabled: true },
  { id: 'source', eyebrow: '01 · SOURCE', title: '选择角色起点', x: 70, y: 280, status: 'ready', hasInput: false, hasOutput: true, outputEnabled: true },
  { id: 'master-gen', eyebrow: '02 · GENERATE', title: '生成参考母版', x: 510, y: 180, status: 'idle', hasInput: true, hasOutput: true, outputEnabled: false },
  { id: 'master', eyebrow: '03 · CONFIRM', title: '确认母版', x: 950, y: 240, status: 'idle', hasInput: true, hasOutput: true, outputEnabled: false },
  { id: 'walk-key', eyebrow: '04 · WALK', title: 'Walk 第一帧', x: 1390, y: 60, status: 'idle', hasInput: true, hasOutput: true, outputEnabled: false },
  { id: 'idle-key', eyebrow: '04 · IDLE', title: 'Idle 第一帧', x: 1390, y: 570, status: 'idle', hasInput: true, hasOutput: true, outputEnabled: false },
  { id: 'custom-action', eyebrow: '04+ · CUSTOM', title: '自定义动作', x: 1390, y: 300, status: 'locked', hasInput: true, hasOutput: true, outputEnabled: false },
  { id: 'walk-animation', eyebrow: '05 · WALK', title: 'Walk 动画', x: 1820, y: 60, status: 'idle', hasInput: true, hasOutput: true, outputEnabled: false },
  { id: 'idle-animation', eyebrow: '05 · IDLE', title: 'Idle 动画', x: 1820, y: 570, status: 'idle', hasInput: true, hasOutput: true, outputEnabled: false },
  { id: 'publish', eyebrow: '06 · PUBLISH', title: '正式入库', x: 2260, y: 300, status: 'idle', hasInput: true, hasOutput: false, outputEnabled: false },
]

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  idle: '尚未生成',
  locked: '等待上游',
  ready: '可以生成',
  generating: '生成中',
  review: '等待确认',
  confirmed: '已确认',
}

export type StudioMode = 'workflow' | null
