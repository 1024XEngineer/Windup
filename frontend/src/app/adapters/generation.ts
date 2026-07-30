import type {
  Generation,
  GenerationApis,
  GenerationInput,
  GenerationType,
} from '@/entities'

import { post } from './http-client'

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
): Generation<T> {
  return {
    id: String(raw.id),
    projectId: String(raw.project_id),
    type: raw.task_type as T,
    status: STATUS_MAP[raw.status] ?? 'pending',
    result: raw.result as Generation['result'],
    error: raw.error_message,
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
      num_images: 1,
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
    num_frames: 16,
  }
}

/* ─── 适配器 ─── */

const GENERATION_ENDPOINTS: Record<string, string> = {
  character_template: '/generation/image',
  first_frame: '/generation/action',
  complete_animation: '/generation/action',
}

export function createGenerationApis(): GenerationApis {
  return {
    async create<T extends GenerationInput>(
      input: T,
    ): Promise<Generation<T['type']>> {
      const endpoint = GENERATION_ENDPOINTS[input.type]
      if (!endpoint) throw new Error(`未知的生成类型：${input.type}`)

      const payload = toBackendPayload(input, 1) // TODO: 接入认证后替换 userId
      const raw = await post<BackendGenerationTask>(endpoint, payload)
      return toGeneration<T['type']>(raw)
    },

    async get(
      projectId: string,
      id: string,
    ): Promise<Generation> {
      // 复用 TaskApis 的查询接口
      const { createTaskApis } = await import('./task')
      const taskApis = createTaskApis()
      const task = await taskApis.get(projectId, id)
      return {
        id: task.id,
        projectId,
        type: task.type as GenerationType,
        status: task.status,
        result: task.result as Generation['result'],
        error: task.error,
      }
    },
  }
}
