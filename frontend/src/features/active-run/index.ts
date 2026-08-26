import { ApiError } from '@/shared/api'

/**
 * 进行中生成任务的本地指针。
 *
 * runId 本身只活在 `/quick-start/:runId` 的 URL 里，用户离开那个地址后就没有
 * 任何地方记得它。这里只存“当前用户最近一条还没结束的任务”这个指针，供 Header
 * 提供返回入口；它不是任务状态的副本，真相仍然是后端的 WorkflowRun。
 */
const storageKeyPrefix = 'windup.quick-start.active-run.v2.'

/**
 * `storage` 事件只在其他标签页写入时触发，本标签页自己写不会收到。
 * Header 与写入方在同一个标签页里，因此另开一条同页广播。
 */
const changeEvent = 'windup:active-run-change'

type ActiveRunStorageTarget = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface ActiveRunStorage {
  remember(userId: string, runId: string): void
  read(userId: string): string | null
  forget(userId: string, runId: string): boolean
}

function storageKey(userId: string): string {
  return `${storageKeyPrefix}${encodeURIComponent(userId)}`
}

function getLocalStorage(): ActiveRunStorageTarget | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

/** localStorage 是跨刷新增强能力；被浏览器拒绝时，本标签页继续用内存指针。 */
export function createActiveRunStorage(storage?: ActiveRunStorageTarget | null): ActiveRunStorage {
  const memory = new Map<string, string>()
  let memoryOnly = false
  const resolveStorage = () => (storage === undefined ? getLocalStorage() : storage)

  return {
    remember(userId, runId) {
      const key = storageKey(userId)
      memory.set(key, runId)
      if (memoryOnly) return
      try {
        resolveStorage()?.setItem(key, runId)
      } catch {
        memoryOnly = true
      }
    },
    read(userId) {
      const key = storageKey(userId)
      if (memoryOnly) return memory.get(key) ?? null
      try {
        const stored = resolveStorage()?.getItem(key) ?? null
        if (stored === null) memory.delete(key)
        else memory.set(key, stored)
      } catch {
        memoryOnly = true
      }
      return memory.get(key) ?? null
    },
    forget(userId, runId) {
      const key = storageKey(userId)
      if (this.read(userId) !== runId) return false
      memory.delete(key)
      if (!memoryOnly) {
        try {
          resolveStorage()?.removeItem(key)
        } catch {
          memoryOnly = true
        }
      }
      return true
    },
  }
}

const activeRunStorage = createActiveRunStorage()

function broadcast(userId: string): void {
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: { userId } }))
}

export function rememberActiveRun(userId: string, runId: string): void {
  activeRunStorage.remember(userId, runId)
  broadcast(userId)
}

export function readActiveRun(userId: string): string | null {
  return activeRunStorage.read(userId)
}

/**
 * 只在指针仍指向 runId 时才清除。用户可能已经开始了下一条任务，而上一条的
 * 结束回调这时才到；无条件清除会把新任务的入口一起抹掉。
 */
export function forgetActiveRun(userId: string, runId: string): void {
  if (activeRunStorage.forget(userId, runId)) broadcast(userId)
}

/**
 * 只取判断“是否还在生成”所需的最小形状，不引 entities 的 WorkflowRun：
 * 这个 feature 只认指针，不认工作流语义。
 */
export interface ActiveRunNodeSnapshot {
  status: string
  phase: string
  /** 归档时间；实体里是可选字段，未归档的节点可能整个缺省。 */
  deletedAt?: string | null
}

export interface ActiveRunSnapshot {
  id: string
  nodes: readonly ActiveRunNodeSnapshot[]
}

/**
 * 按最新的工作流快照对齐指针。生成结束后的选择、审核仍是未完成创作，
 * 因此以非归档的 active 节点为恢复边界，不把 generating 误当成唯一的进度。
 */
export function syncActiveRun(userId: string, run: ActiveRunSnapshot | null): void {
  if (!run) return
  const unfinished = run.nodes.some((node) => !node.deletedAt && node.status === 'active')
  if (unfinished) rememberActiveRun(userId, run.id)
  else forgetActiveRun(userId, run.id)
}

/** 只有后端明确确认无权访问或记录不存在时，旧入口才应被丢弃。 */
export function isMissingActiveRunError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 403 || error.code === 404 || error.status === 403 || error.status === 404)
  )
}

/** 订阅当前用户的指针变化；同时覆盖本标签页写入和其他标签页的 `storage` 事件。 */
export function subscribeActiveRun(userId: string, listener: () => void): () => void {
  const key = storageKey(userId)
  const onChange = (event: Event) => {
    if (event instanceof StorageEvent) {
      if (event.key === key || event.key === null) listener()
      return
    }
    if (event instanceof CustomEvent && event.detail?.userId === userId) listener()
  }
  window.addEventListener(changeEvent, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(changeEvent, onChange)
    window.removeEventListener('storage', onChange)
  }
}
