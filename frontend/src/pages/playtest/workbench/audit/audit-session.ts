import type { PlaytestDirection } from '../model/types'

export type ManualIssueCategory =
  | 'subject_cropped'
  | 'transparency'
  | 'image_unavailable'
  | 'duplicate_frame'
  | 'motion_discontinuity'
  | 'motion_direction'
  | 'style_inconsistent'
  | 'other'

export interface ManualAuditIssue {
  id: string
  category: ManualIssueCategory
  actionId: string
  direction: PlaytestDirection
  frameIndex: number
  imageUrl: string
  note: string
}

export type AuditSessionAction =
  | { type: 'add'; issue: ManualAuditIssue }
  | { type: 'update'; id: string; category: ManualIssueCategory; note: string }
  | { type: 'remove'; id: string }

export function reduceAuditSession(
  state: readonly ManualAuditIssue[],
  action: AuditSessionAction,
): readonly ManualAuditIssue[] {
  if (action.type === 'add') return [...state, action.issue]
  if (action.type === 'remove') {
    if (!state.some((issue) => issue.id === action.id)) return state
    return state.filter((issue) => issue.id !== action.id)
  }
  if (!state.some((issue) => issue.id === action.id)) return state
  return state.map((issue) =>
    issue.id === action.id ? { ...issue, category: action.category, note: action.note } : issue,
  )
}
