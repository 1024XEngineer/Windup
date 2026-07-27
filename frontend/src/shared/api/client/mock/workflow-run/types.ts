/** 后端形状，snake_case 对齐 Project（PR #57）。id 类型待 #60 确认，暂用 string。 */
export const NODE_ORDER = ['asset', 'generation', 'candidate', 'review', 'export'] as const

export type NodeTypeDto = (typeof NODE_ORDER)[number]
export type NodeStatusDto = 'locked' | 'available' | 'active' | 'passed' | 'failed'

export interface NodeDto {
  id: string
  type: NodeTypeDto
  order: number
  status: NodeStatusDto
  input: unknown
  output: unknown
  reference_node_ids: string[]
  quality_failure_count: number
}

export interface RevisionDto {
  id: string
  based_on_revision_id: string | null
  restart_node_id: string | null
  status: 'active' | 'completed' | 'failed' | 'abandoned'
  nodes: NodeDto[]
  generation_status: 'in_progress' | 'completed' | 'failed'
  export_status: 'not_exported' | 'exporting' | 'exported' | 'failed'
  playtest_status: 'not_tested' | 'passed' | 'issues_found'
  created_at: string
}

export interface RunDto {
  id: string
  project_id: string
  character_id: string | null
  driver: 'ai' | 'manual'
  status: 'active' | 'completed' | 'failed'
  current_revision_id: string
  revisions: RevisionDto[]
  prompt: string | null
}

export type CommandDto =
  | { kind: 'complete-node'; node_id: string; output?: unknown }
  | { kind: 'fail-node'; node_id: string; error: string }
  | { kind: 'record-quality-result'; node_id: string; passed: boolean; report?: unknown }
  | { kind: 'restart-from-node'; source_revision_id: string; node_id: string }
  | { kind: 'set-export-status'; status: RevisionDto['export_status'] }
  | { kind: 'record-playtest'; revision_id: string; status: 'passed' | 'issues_found' }
