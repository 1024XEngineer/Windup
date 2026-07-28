import {
  WORKFLOW_NODE_ORDER,
  type WorkflowNode,
  type WorkflowRevision,
  type WorkflowRun,
} from '../model/types'

type UnknownRecord = Record<string, unknown>

const DRIVERS = ['ai', 'manual'] as const
const RUN_STATUSES = ['active', 'completed', 'failed'] as const
const REVISION_STATUSES = ['active', 'completed', 'failed', 'abandoned'] as const
const NODE_STATUSES = ['locked', 'available', 'active', 'passed', 'failed'] as const
const GENERATION_STATUSES = ['not_started', 'in_progress', 'completed', 'failed'] as const
const EXPORT_STATUSES = ['not_exported', 'exporting', 'exported', 'failed'] as const
const PLAYTEST_STATUSES = ['not_tested', 'passed', 'issues_found'] as const

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value)
}

function isEnum<const T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value as T[number])
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function hasUniqueIds(items: Array<{ id: string }>): boolean {
  return new Set(items.map((item) => item.id)).size === items.length
}

function isWorkflowNode(value: unknown, index: number): value is WorkflowNode {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isEnum(value.type, WORKFLOW_NODE_ORDER) &&
    value.order === index &&
    isEnum(value.status, NODE_STATUSES) &&
    Object.hasOwn(value, 'input') &&
    Object.hasOwn(value, 'output') &&
    isStringArray(value.referenceNodeIds) &&
    isNonNegativeInteger(value.qualityFailureCount)
  )
}

function isWorkflowRevision(value: unknown): value is WorkflowRevision {
  if (!isRecord(value) || !Array.isArray(value.nodes) || value.nodes.length === 0) return false
  if (!value.nodes.every((node, index) => isWorkflowNode(node, index))) return false
  const nodes = value.nodes as WorkflowNode[]

  return (
    isNonEmptyString(value.id) &&
    isNullableString(value.basedOnRevisionId) &&
    isNullableString(value.restartNodeId) &&
    isEnum(value.status, REVISION_STATUSES) &&
    hasUniqueIds(nodes) &&
    isEnum(value.generationStatus, GENERATION_STATUSES) &&
    isEnum(value.exportStatus, EXPORT_STATUSES) &&
    isEnum(value.playtestStatus, PLAYTEST_STATUSES) &&
    isNonEmptyString(value.createdAt) &&
    !Number.isNaN(Date.parse(value.createdAt))
  )
}

function isWorkflowRun(value: unknown): value is WorkflowRun {
  if (!isRecord(value) || !Array.isArray(value.revisions) || value.revisions.length === 0) {
    return false
  }
  if (!value.revisions.every(isWorkflowRevision)) return false
  const revisions = value.revisions as WorkflowRevision[]

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.projectId) &&
    isNullableString(value.characterId) &&
    isEnum(value.driver, DRIVERS) &&
    isEnum(value.status, RUN_STATUSES) &&
    isNonEmptyString(value.currentRevisionId) &&
    hasUniqueIds(revisions) &&
    revisions.some((revision) => revision.id === value.currentRevisionId) &&
    isNullableString(value.prompt)
  )
}

/** 逐条过滤浏览器存储数据，损坏记录不会进入 WorkflowRun 领域层。 */
export function parseWorkflowRunMap(value: unknown): Record<string, WorkflowRun> {
  if (!isRecord(value)) return {}

  const entries: Array<[string, WorkflowRun]> = []
  for (const [key, candidate] of Object.entries(value)) {
    if (isWorkflowRun(candidate) && key === candidate.id) entries.push([key, candidate])
  }
  return Object.fromEntries(entries)
}
