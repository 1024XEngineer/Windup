import type {
  WorkflowCommand,
  WorkflowNode,
  WorkflowRevision,
  WorkflowRun,
} from '../model/types'

/** 后端原始形状，只在 api/ 内出现；出了这里全项目只认 WorkflowRun。 */
export interface WorkflowNodeDto {
  id: string
  type: WorkflowNode['type']
  order: number
  status: WorkflowNode['status']
  input: unknown
  output: unknown
  reference_node_ids: string[]
  quality_failure_count: number
}

export interface WorkflowRevisionDto {
  id: string
  based_on_revision_id: string | null
  restart_node_id: string | null
  status: WorkflowRevision['status']
  nodes: WorkflowNodeDto[]
  generation_status: WorkflowRevision['generationStatus']
  export_status: WorkflowRevision['exportStatus']
  playtest_status: WorkflowRevision['playtestStatus']
  created_at: string
}

export interface WorkflowRunDto {
  id: string
  project_id: string
  character_id: string | null
  driver: WorkflowRun['driver']
  status: WorkflowRun['status']
  current_revision_id: string
  revisions: WorkflowRevisionDto[]
  prompt: string | null
}

export function toWorkflowRun(dto: WorkflowRunDto): WorkflowRun {
  return {
    id: dto.id,
    projectId: dto.project_id,
    characterId: dto.character_id,
    driver: dto.driver,
    status: dto.status,
    currentRevisionId: dto.current_revision_id,
    revisions: dto.revisions.map(toRevision),
    prompt: dto.prompt,
  }
}

function toRevision(dto: WorkflowRevisionDto): WorkflowRevision {
  return {
    id: dto.id,
    basedOnRevisionId: dto.based_on_revision_id,
    restartNodeId: dto.restart_node_id,
    status: dto.status,
    nodes: dto.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      order: node.order,
      status: node.status,
      input: node.input,
      output: node.output,
      referenceNodeIds: node.reference_node_ids,
      qualityFailureCount: node.quality_failure_count,
    })),
    generationStatus: dto.generation_status,
    exportStatus: dto.export_status,
    playtestStatus: dto.playtest_status,
    createdAt: dto.created_at,
  }
}

export function toCommandDto(command: WorkflowCommand): Record<string, unknown> {
  switch (command.kind) {
    case 'complete-node':
      return { kind: command.kind, node_id: command.nodeId, output: command.output }
    case 'fail-node':
      return { kind: command.kind, node_id: command.nodeId, error: command.error }
    case 'record-quality-result':
      return {
        kind: command.kind,
        node_id: command.nodeId,
        passed: command.passed,
        report: command.report,
      }
    case 'restart-from-node':
      return {
        kind: command.kind,
        source_revision_id: command.sourceRevisionId,
        node_id: command.nodeId,
      }
    case 'set-export-status':
      return { kind: command.kind, status: command.status }
    case 'record-playtest':
      return { kind: command.kind, revision_id: command.revisionId, status: command.status }
  }
}
