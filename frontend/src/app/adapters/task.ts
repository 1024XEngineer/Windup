import type { Task, TaskApis, TaskEvent, TaskStatus, TaskType } from '@/entities'

import { get } from './http-client'

/* ─── 后端 DTO ─── */

interface BackendTask {
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

const TASK_TYPE_MAP: Record<string, TaskType> = {
  character_image: 'character_template',
  character_template: 'character_template',
  character_action: 'complete_animation',
  first_frame: 'first_frame',
  complete_animation: 'complete_animation',
}

const TASK_STATUS_MAP: Record<string, TaskStatus> = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
}

function toTask(raw: BackendTask): Task {
  return {
    id: String(raw.id),
    type: TASK_TYPE_MAP[raw.task_type] ?? 'character_template',
    status: TASK_STATUS_MAP[raw.status] ?? 'pending',
    error: raw.error_message,
    result: raw.result,
  }
}

function toTaskEvent(raw: BackendTask): TaskEvent {
  return {
    taskId: String(raw.id),
    type: TASK_TYPE_MAP[raw.task_type] ?? 'character_template',
    status: TASK_STATUS_MAP[raw.status] ?? 'pending',
    error: raw.error_message,
    result: raw.result,
  }
}

/* ─── 适配器 ─── */

const POLL_INTERVAL_MS = 2000

export function createTaskApis(): TaskApis {
  return {
    async get(projectId: string, taskId: string): Promise<Task> {
      const raw = await get<BackendTask>(
        `/generation/tasks/${taskId}?project_id=${encodeURIComponent(projectId)}`,
      )
      return toTask(raw)
    },

    subscribe(
      projectId: string,
      taskId: string,
      onEvent: (event: TaskEvent) => void,
    ): () => void {
      let active = true
      let timer: ReturnType<typeof setTimeout> | null = null

      const poll = async () => {
        if (!active) return
        try {
          const raw = await get<BackendTask>(
            `/generation/tasks/${taskId}?project_id=${encodeURIComponent(projectId)}`,
          )
          if (!active) return
          onEvent(toTaskEvent(raw))
          if (raw.status === 'completed' || raw.status === 'failed') {
            return // 终态，停止轮询
          }
          timer = setTimeout(poll, POLL_INTERVAL_MS)
        } catch {
          // 请求失败时继续重试
          if (active) timer = setTimeout(poll, POLL_INTERVAL_MS)
        }
      }

      // 立即发送一次当前状态
      void poll()

      return () => {
        active = false
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
      }
    },
  }
}
