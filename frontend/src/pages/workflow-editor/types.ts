/** 工作流编辑器类型定义，对齐 skeleton 的节点画布设计。 */

/** 工作流节点类型 */
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

/** 节点状态 */
export type NodeStatus = 'idle' | 'locked' | 'ready' | 'generating' | 'review' | 'confirmed'

/** 工作流节点定义 */
export interface WorkflowNode {
  id: WorkflowNodeType
  eyebrow: string
  title: string
  description: string
  x: number
  y: number
  status: NodeStatus
  hasInput: boolean
  hasOutput: boolean
  outputEnabled: boolean
}

/** 节点连接 */
export interface NodeConnection {
  from: WorkflowNodeType
  to: WorkflowNodeType
}

/** 工作流状态 */
export interface WorkflowState {
  nodes: Map<WorkflowNodeType, WorkflowNode>
  connections: Set<string>
  activeNode: WorkflowNodeType | null
}

/** 允许的节点连接 — 与 skeleton node-canvas.js 保持一致 */
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

/** 初始节点位置 — 匹配 skeleton 布局 */
export const INITIAL_NODES: WorkflowNode[] = [
  {
    id: 'project',
    eyebrow: '01 · PROJECT',
    title: '项目信息',
    description: '填写项目名称、视角、画布尺寸和美术风格。',
    x: 60,
    y: 240,
    status: 'confirmed',
    hasInput: false,
    hasOutput: true,
    outputEnabled: true,
  },
  {
    id: 'source',
    eyebrow: '02 · SOURCE',
    title: '选择角色起点',
    description: '选择母版输入方式：新建、上传参考图或从已有角色复用。',
    x: 400,
    y: 240,
    status: 'ready',
    hasInput: true,
    hasOutput: true,
    outputEnabled: true,
  },
  {
    id: 'master-gen',
    eyebrow: '03 · GENERATE',
    title: '生成参考母版',
    description: '基于角色设定生成候选母版图，约 15 秒。',
    x: 800,
    y: 240,
    status: 'idle',
    hasInput: true,
    hasOutput: true,
    outputEnabled: false,
  },
  {
    id: 'master',
    eyebrow: '04 · CONFIRM',
    title: '确认母版',
    description: '从候选中选择一张作为身份母版，后续动作均基于此。',
    x: 1200,
    y: 240,
    status: 'idle',
    hasInput: true,
    hasOutput: true,
    outputEnabled: false,
  },
  {
    id: 'walk-key',
    eyebrow: '05 · WALK',
    title: 'Walk 第一帧',
    description: '描述步态、重心和速度，生成行走动作首帧。',
    x: 1620,
    y: 60,
    status: 'idle',
    hasInput: true,
    hasOutput: true,
    outputEnabled: false,
  },
  {
    id: 'idle-key',
    eyebrow: '06 · IDLE',
    title: 'Idle 第一帧',
    description: '描述呼吸、重心和待机细节，生成待机动作首帧。',
    x: 1620,
    y: 420,
    status: 'idle',
    hasInput: true,
    hasOutput: true,
    outputEnabled: false,
  },
  {
    id: 'custom-action',
    eyebrow: '06+ · CUSTOM',
    title: '自定义动作',
    description: '添加额外动作类型，如攻击、跳跃或特殊动作。',
    x: 1620,
    y: 240,
    status: 'locked',
    hasInput: true,
    hasOutput: true,
    outputEnabled: false,
  },
  {
    id: 'walk-animation',
    eyebrow: '07 · WALK',
    title: 'Walk 动画',
    description: '首帧确认后，生成完整 8 帧行走循环动画。',
    x: 2040,
    y: 60,
    status: 'idle',
    hasInput: true,
    hasOutput: true,
    outputEnabled: false,
  },
  {
    id: 'idle-animation',
    eyebrow: '08 · IDLE',
    title: 'Idle 动画',
    description: '首帧确认后，生成完整 8 帧待机循环动画。',
    x: 2040,
    y: 420,
    status: 'idle',
    hasInput: true,
    hasOutput: true,
    outputEnabled: false,
  },
  {
    id: 'publish',
    eyebrow: '09 · PUBLISH',
    title: '正式入库',
    description: '母版、Idle 与 Walk 已完成，确认后写入正式资产。',
    x: 2460,
    y: 240,
    status: 'idle',
    hasInput: true,
    hasOutput: false,
    outputEnabled: false,
  },
]

/** 节点状态标签 */
export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  idle: '尚未生成',
  locked: '等待上游',
  ready: '可以生成',
  generating: '生成中…',
  review: '等待确认',
  confirmed: '已确认',
}

/** 节点状态样式 — 匹配 asset lab 的 paper-like 设计 */
export const NODE_STATUS_CLASSES: Record<NodeStatus, string> = {
  idle: 'border-[#c8c2b7] bg-[#ece9e1] text-[#737378]',
  locked: 'border-[#c8c2b7] bg-[#ece9e1] text-[#a2a69f]',
  ready: 'border-[#b9b3a7] bg-[#e8e5dd] text-[#1d1d1f]',
  generating: 'border-[#1d1d1f] bg-[#1d1d1f] text-white',
  review: 'border-[#8e8e93] bg-[#e8e5dd] text-[#1d1d1f]',
  confirmed: 'border-[#86a18d] bg-[#e9ede9] text-[#3a3a3c]',
}

/** 生成类型 */
export type GenerationType = 'master' | 'keyframe' | 'animation'

/** 生成状态 */
export interface GenerationState {
  type: GenerationType
  action?: 'walk' | 'idle'
  status: 'idle' | 'running' | 'completed' | 'failed'
  progress: number
  error?: string
}

/** 工作流快照 */
export interface WorkflowSnapshot {
  projectId: string
  projectName: string
  masterCandidate: string | null
  generation: GenerationState
  actions: {
    walk: { keyframe: NodeStatus; animation: NodeStatus }
    idle: { keyframe: NodeStatus; animation: NodeStatus }
  }
}

/** 创作模式 */
export type StudioMode = 'workflow' | 'natural' | null
