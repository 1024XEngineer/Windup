export interface QuickStartConversationTurn {
  role: 'user' | 'assistant'
  content: string
  [key: string]: unknown
}

export interface QuickStartConversation {
  runId: string
  turns: readonly QuickStartConversationTurn[]
  schemaVersion: 2
  version: number
  updatedAt: string | null
}

export interface SaveQuickStartConversationInput {
  turns: readonly QuickStartConversationTurn[]
  version: number
}

export interface QuickStartConversationApis {
  get(runId: string): Promise<QuickStartConversation>
  save(runId: string, input: SaveQuickStartConversationInput): Promise<QuickStartConversation>
}

export { QuickStartConversationConflictError, quickStartConversationApis } from './api'
