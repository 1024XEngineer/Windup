import { ApiError, createApiClient, getApiAccessToken } from '@/shared/api'
import type {
  QuickStartConversation,
  QuickStartConversationApis,
  QuickStartConversationTurn,
} from './index'

interface ConversationDto {
  run_id: number
  turns: unknown[]
  schema_version: number
  version: number
  updated_at: string | null
}

const CONVERSATION_READ_TIMEOUT_MS = 5_000
const CONVERSATION_WRITE_TIMEOUT_MS = 10_000

export class QuickStartConversationConflictError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'QuickStartConversationConflictError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTurn(value: unknown): value is QuickStartConversationTurn {
  return (
    isRecord(value) &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    value.content.trim().length > 0
  )
}

function mapConversation(dto: ConversationDto): QuickStartConversation {
  if (
    !isRecord(dto) ||
    !Number.isSafeInteger(dto.run_id) ||
    dto.run_id <= 0 ||
    !Array.isArray(dto.turns) ||
    !dto.turns.every(isTurn) ||
    dto.schema_version !== 2 ||
    !Number.isSafeInteger(dto.version) ||
    dto.version < 0 ||
    !(dto.updated_at === null || typeof dto.updated_at === 'string')
  ) {
    throw new ApiError('后端 Quick Start Agent 对话响应格式无效', {
      kind: 'invalid-response',
      data: dto,
    })
  }
  return {
    runId: String(dto.run_id),
    turns: structuredClone(dto.turns),
    schemaVersion: 2,
    version: dto.version,
    updatedAt: dto.updated_at,
  }
}

function toBackendId(runId: string): number {
  const parsed = Number(runId)
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  throw new TypeError('runId 必须是正整数 ID')
}

function getApiClient() {
  return createApiClient({ getAccessToken: getApiAccessToken })
}

export const quickStartConversationApis: QuickStartConversationApis = {
  async get(runId) {
    toBackendId(runId)
    return mapConversation(
      await getApiClient().request<ConversationDto>(
        `/workflow-runs/${encodeURIComponent(runId)}/agent-conversation`,
        { signal: AbortSignal.timeout(CONVERSATION_READ_TIMEOUT_MS) },
      ),
    )
  },

  async save(runId, input) {
    toBackendId(runId)
    try {
      return mapConversation(
        await getApiClient().request<ConversationDto>(
          `/workflow-runs/${encodeURIComponent(runId)}/agent-conversation`,
          {
            method: 'PUT',
            replayAfterAuth: true,
            signal: AbortSignal.timeout(CONVERSATION_WRITE_TIMEOUT_MS),
            json: {
              turns: input.turns,
              schema_version: 2,
              version: input.version,
            },
          },
        ),
      )
    } catch (cause) {
      if (cause instanceof ApiError && cause.kind === 'business' && cause.code === 409) {
        throw new QuickStartConversationConflictError(cause.message, { cause })
      }
      throw cause
    }
  },
}
