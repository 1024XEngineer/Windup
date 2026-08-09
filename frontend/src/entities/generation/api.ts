import {
  type CharacterActionFrame,
  type CharacterActionOutput,
  type Generation,
  type GenerationApis,
  type GenerationEvent,
  type GenerationInput,
  type GenerationType,
} from '.'

import { get, getApiAccessToken, post, recoverApiUnauthorized } from '@/shared/api'
import {
  createEventStreamSubscriber,
  EventStreamError,
  type EventStreamSubscriber,
} from '@/shared/api/stream'

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

function toGeneration<T extends GenerationType = GenerationType>(
  raw: BackendGenerationTask,
  expectedType?: T,
): Generation<T> {
  const type = (expectedType ?? raw.task_type) as T
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

  if (type === 'character_image') {
    const result = value as { image_urls?: unknown }
    return Array.isArray(result.image_urls)
      ? {
          type: 'character_image' as const,
          imageUrls: result.image_urls.filter(
            (url): url is string => typeof url === 'string' && url.length > 0,
          ),
        }
      : null
  }

  const action = value as {
    action_type?: unknown
    frames?: readonly {
      index?: number
      image_url?: unknown
      duration_ms?: unknown
    }[]
  }
  const knownTypes = new Set(['walk', 'idle', 'attack', 'jump', 'custom'])
  const frames: CharacterActionFrame[] = Array.isArray(action.frames)
    ? [...action.frames]
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .filter((frame) => typeof frame.image_url === 'string' && frame.image_url.length > 0)
        .map((frame) => ({
          index: frame.index ?? 0,
          imageUrl: frame.image_url as string,
          durationMs: typeof frame.duration_ms === 'number' ? frame.duration_ms : null,
        }))
    : []

  if (frames.length === 0) return null

  return {
    type: 'character_action' as const,
    actionType:
      typeof action.action_type === 'string' && knownTypes.has(action.action_type)
        ? (action.action_type as CharacterActionOutput['actionType'])
        : 'custom',
    frames,
  }
}

/* ─── 输入 → 后端请求体 ─── */

function toBackendPayload(input: GenerationInput) {
  if (input.type === 'character_image') {
    return {
      project_id: Number(input.projectId),
      prompt: input.prompt,
      reference_image_url: input.referenceMedia[0] ?? null,
      width: input.spriteWidth,
      height: input.spriteHeight,
      num_images: 4,
    }
  }

  // character_action
  return {
    project_id: Number(input.projectId),
    character_id: Number(input.characterId),
    action_type: input.actionType,
    custom_prompt: input.prompt,
    reference_video_url: null,
    reference_image_urls: [
      ...new Set(
        input.firstFrameUrl
          ? [input.firstFrameUrl, ...input.referenceMedia.map(String)]
          : input.referenceMedia.map(String),
      ),
    ],
    num_frames: input.numFrames,
  }
}

/* ─── 适配器 ─── */

const GENERATION_ENDPOINTS: Record<string, string> = {
  character_image: '/generation/image',
  character_action: '/generation/action',
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
  // PR #34 的 SSE 使用 `id`；兼容旧服务曾返回的 `task_id`，统一映射成前端 taskId。
  const taskId = event.id ?? event.task_id
  const taskType = event.task_type
  const status = event.status
  if ((typeof taskId !== 'string' && typeof taskId !== 'number') || typeof taskType !== 'string') {
    throw new Error('task_update 缺少任务标识或类型')
  }
  if (typeof status !== 'string' || !(status in STATUS_MAP)) {
    throw new Error('task_update 状态无效')
  }
  return {
    taskId: String(taskId),
    type: taskType as GenerationType,
    status: STATUS_MAP[status]!,
    result: toGenerationResult(taskType as GenerationType, event.result),
    error: typeof event.error_message === 'string' ? event.error_message : null,
  }
}

export interface GenerationApiOptions {
  /** 测试或特殊宿主可替换流传输；默认使用可鉴权的 fetch SSE。 */
  stream?: EventStreamSubscriber
  /** SSE 尚未部署时的查询间隔。 */
  pollIntervalMs?: number
}

function toGenerationEvent(generation: Generation): GenerationEvent {
  return {
    taskId: generation.id,
    type: generation.type,
    status: generation.status,
    result: generation.result,
    error: generation.error,
  }
}

function wait(delayMs: number): Promise<void> {
  return delayMs <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, delayMs))
}

export function createGenerationApis(options: GenerationApiOptions = {}): GenerationApis {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000

  const apis: GenerationApis = {
    async create<T extends GenerationInput>(input: T): Promise<Generation<T['type']>> {
      const endpoint = GENERATION_ENDPOINTS[input.type]
      if (!endpoint) throw new Error(`未知的生成类型：${input.type}`)

      const payload = toBackendPayload(input)
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
      const stream =
        options.stream ??
        createEventStreamSubscriber({
          getAccessToken: getApiAccessToken,
          recoverUnauthorized: recoverApiUnauthorized,
        })
      let stopped = false
      let polling = false
      let stopStream: () => void = () => undefined

      const startPolling = () => {
        if (polling || stopped) return
        polling = true
        void (async () => {
          while (!stopped) {
            try {
              const generation = await apis.get(projectId, id)
              if (stopped) return
              const event = toGenerationEvent(generation)
              onEvent(event)
              if (event.status === 'completed' || event.status === 'failed') return
              await wait(pollIntervalMs)
            } catch (error) {
              if (!stopped) onError(error instanceof Error ? error : new Error('任务查询失败'))
              return
            }
          }
        })()
      }

      stopStream = stream(streamUrl(projectId, id), {
        eventName: 'task_update',
        onEvent(data) {
          const event = parseTaskUpdate(data)
          if (event.taskId !== id) throw new Error('task_update 与订阅任务不一致')
          onEvent(event)
          return event.status === 'completed' || event.status === 'failed'
        },
        onError(error) {
          if (error instanceof EventStreamError && error.status === 404) {
            stopStream()
            startPolling()
            return
          }
          onError(error)
        },
      })

      return () => {
        if (stopped) return
        stopped = true
        stopStream()
      }
    },
  }

  return apis
}
