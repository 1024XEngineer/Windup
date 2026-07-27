/** Quick Start 与手动工作流只改变输入方式，共用同一种运行模型。 */
export type WorkflowDriver = 'ai' | 'manual'

export const WORKFLOW_NODE_ORDER = [
  'asset',
  'generation',
  'candidate',
  'review',
  'export',
] as const

export type WorkflowNodeType = (typeof WORKFLOW_NODE_ORDER)[number]
export type WorkflowNodeStatus = 'locked' | 'available' | 'active' | 'passed' | 'failed'
export type WorkflowRevisionStatus = 'active' | 'completed' | 'failed' | 'abandoned'
export type WorkflowRunStatus = 'active' | 'completed' | 'failed'
export type GenerationStatus = 'in_progress' | 'completed' | 'failed'
export type ExportStatus = 'not_exported' | 'exporting' | 'exported' | 'failed'
export type PlaytestStatus = 'not_tested' | 'passed' | 'issues_found'

export interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  order: number
  status: WorkflowNodeStatus
  input: unknown
  output: unknown
  referenceNodeIds: string[]
  qualityFailureCount: number
}

export interface WorkflowRevision {
  id: string
  basedOnRevisionId: string | null
  restartNodeId: string | null
  status: WorkflowRevisionStatus
  nodes: WorkflowNode[]
  generationStatus: GenerationStatus
  exportStatus: ExportStatus
  playtestStatus: PlaytestStatus
  createdAt: string
}

export interface WorkflowRun {
  id: string
  projectId: string
  characterId: string | null
  driver: WorkflowDriver
  status: WorkflowRunStatus
  currentRevisionId: string
  revisions: WorkflowRevision[]
  prompt: string | null
}

export interface CreateWorkflowRunInput {
  projectId: string
  driver: WorkflowDriver
  prompt?: string
}

export type WorkflowCommand =
  | { kind: 'complete-node'; nodeId: string; output?: unknown }
  | { kind: 'fail-node'; nodeId: string; error: string }
  | { kind: 'record-quality-result'; nodeId: string; passed: boolean; report?: unknown }
  | { kind: 'restart-from-node'; sourceRevisionId: string; nodeId: string }
  | { kind: 'set-export-status'; status: ExportStatus }
  | { kind: 'record-playtest'; revisionId: string; status: Exclude<PlaytestStatus, 'not_tested'> }

export type WorkflowCommandKind = WorkflowCommand['kind']

export interface WorkflowLocation {
  runId: string
  revisionId: string
  nodeId: string
  actionId?: string
  frameIndex?: number
}
