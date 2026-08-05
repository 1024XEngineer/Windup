import {
  COMPLETE_ANIMATION_FRAME_COUNT,
  type Generation,
  type GenerationApis,
  type GenerationEvent,
  type GenerationInput,
  type GenerationType,
} from '.'

import { get, post } from '@/shared/api'
import { subscribeToEventStream } from '@/shared/api/stream'

/* ─── 后端 DTO ─── */

interface BackendGenerationTask {
  id: number
  user_id: number
  project_id: number
  task_type: string
  status: string
  input_payload: Record<string, unknown>
  result: unknown
  error_message: string | null
}

/* ─── 映射 ─── */

const STATUS_MAP: Record<string, Generation['status']> = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
}

const GENERATION_TYPE_MAP: Record<string, GenerationType> = {
  character_image: 'character_template',
  character_template: 'character_template',
  character_action: 'complete_animation',
  first_frame: 'first_frame',
  complete_animation: 'complete_animation',
}

function toGeneration<T extends GenerationType = GenerationType>(
  raw: BackendGenerationTask,
  expectedType?: T,
): Generation<T> {
  const type = expectedType ?? ((GENERATION_TYPE_MAP[raw.task_type] ?? raw.task_type) as T)
  return {
    id: String(raw.id),
    projectId: String(raw.project_id),
    type,
    status: STATUS_MAP[raw.status] ?? 'pending',
    result: toGenerationResult(type, raw.result),
    error: raw.error_message,
  }
}

function toGenerationResult(type: GenerationType, value: unknown): Generation['result'] {
  if (!value || typeof value !== 'object') return null
  if (type === 'character_template') {
    const result = value as { image_urls?: unknown }
    return Array.isArray(result.image_urls)
      ? {
          type: 'character_template',
          images: result.image_urls
            .filter((url): url is string => typeof url === 'string' && url.length > 0)
            .map((url) => ({ url })),
        }
      : null
  }

  const action = value as {
    action_type?: unknown
    frames?: readonly { index?: number; image_url?: unknown; duration_ms?: unknown }[]
  }
  const frames = Array.isArray(action.frames)
    ? [...action.frames]
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .filter((frame) => typeof frame.image_url === 'string' && frame.image_url.length > 0)
        .map((frame) => ({
          url: frame.image_url as string,
          durationMs: typeof frame.duration_ms === 'number' ? frame.duration_ms : null,
        }))
    : []
  if (frames.length === 0) return null
  if (type === 'first_frame') return { type: 'first_frame', image: frames[0]! }

  const knownTypes = new Set(['walk', 'idle', 'attack', 'jump', 'custom'])
  return {
    type: 'complete_animation',
    actionType:
      typeof action.action_type === 'string' && knownTypes.has(action.action_type)
        ? (action.action_type as 'walk' | 'idle' | 'attack' | 'jump' | 'custom')
        : 'custom',
    frames,
  }
}

/* ─── 输入 → 后端请求体 ─── */

function toBackendPayload(input: GenerationInput, userId: number) {
  if (input.type === 'character_template') {
    return {
      user_id: userId,
      project_id: Number(input.projectId),
      prompt: input.prompt,
      reference_image_url: input.referenceMedia[0] ?? null,
      width: input.spriteWidth,
      height: input.spriteHeight,
      num_images: 4,
    }
  }

  if (input.type === 'first_frame') {
    return {
      user_id: userId,
      project_id: Number(input.projectId),
      character_id: Number(input.characterId),
      action_type: input.actionType,
      custom_prompt: input.prompt,
      reference_image_urls: input.referenceMedia.map(String),
      num_frames: 1,
    }
  }

  // complete_animation
  return {
    user_id: userId,
    project_id: Number(input.projectId),
    character_id: Number(input.characterId),
    action_type: input.actionType,
    custom_prompt: input.prompt,
    reference_image_urls: [input.firstFrameUrl, ...input.referenceMedia.map(String)],
    num_frames: COMPLETE_ANIMATION_FRAME_COUNT,
  }
}

/* ─── 适配器 ─── */

const GENERATION_ENDPOINTS: Record<string, string> = {
  character_template: '/generation/image',
  first_frame: '/generation/action',
  complete_animation: '/generation/action',
}

function streamUrl(projectId: string, id: string) {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'
  return `${baseUrl.replace(/\/$/u, '')}/generation/tasks/${encodeURIComponent(id)}/stream?project_id=${encodeURIComponent(projectId)}`
}

function parseTaskUpdate(data: string): GenerationEvent {
  let value: unknown
  try {
    value = JSON.parse(data) as unknown
  } catch (cause) {
    throw new Error('task_update 不是有效 JSON', { cause })
  }
  if (!value || typeof value !== 'object') throw new Error('task_update 不是对象')
  const event = value as Record<string, unknown>
  const taskId = event.task_id
  const taskType = event.task_type
  const status = event.status
  if ((typeof taskId !== 'string' && typeof taskId !== 'number') || typeof taskType !== 'string') {
    throw new Error('task_update 缺少任务标识或类型')
  }
  if (typeof status !== 'string' || !(status in STATUS_MAP)) {
    throw new Error('task_update 状态无效')
  }
  const type = GENERATION_TYPE_MAP[taskType] ?? 'complete_animation'
  return {
    taskId: String(taskId),
    type,
    status: STATUS_MAP[status]!,
    result: toGenerationResult(type, event.result),
    error: typeof event.error_message === 'string' ? event.error_message : null,
  }
}

export function createGenerationApis(): GenerationApis {
  return {
    async create<T extends GenerationInput>(input: T): Promise<Generation<T['type']>> {
      const endpoint = GENERATION_ENDPOINTS[input.type]
      if (!endpoint) throw new Error(`未知的生成类型：${input.type}`)

      const payload = toBackendPayload(input, 1) // TODO: 接入认证后替换 userId
      const raw = await post<BackendGenerationTask>(endpoint, payload)
      return toGeneration<T['type']>(raw, input.type)
    },

    async get(projectId: string, id: string): Promise<Generation> {
      const raw = await get<BackendGenerationTask>(
        `/generation/tasks/${id}?project_id=${encodeURIComponent(projectId)}`,
      )
      return toGeneration(raw)
    },

    subscribe(projectId, id, onEvent, onError = () => undefined) {
      return subscribeToEventStream(streamUrl(projectId, id), {
        eventName: 'task_update',
        onEvent(data) {
          const event = parseTaskUpdate(data)
          if (event.taskId !== id) throw new Error('task_update 与订阅任务不一致')
          onEvent(event)
          return event.status === 'completed' || event.status === 'failed'
        },
        onError,
      })
    },
  }
}
