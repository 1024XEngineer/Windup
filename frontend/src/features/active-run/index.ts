/**
 * 进行中生成任务的本地指针。
 *
 * runId 本身只活在 `/quick-start/:runId` 的 URL 里，用户离开那个地址后就没有
 * 任何地方记得它。这里只存"最近一条还没结束的任务"这一个指针，供 Header 提供
 * 返回入口；它不是任务状态的副本，真相仍然是后端的 WorkflowRun。
 */
const storageKey = 'windup.quick-start.active-run.v1'

/**
 * `storage` 事件只在其他标签页写入时触发，本标签页自己写不会收到。
 * Header 与写入方在同一个标签页里，因此另开一条同页广播。
 */
const changeEvent = 'windup:active-run-change'

function broadcast(): void {
  window.dispatchEvent(new Event(changeEvent))
}

export function rememberActiveRun(runId: string): void {
  window.localStorage.setItem(storageKey, runId)
  broadcast()
}

export function readActiveRun(): string | null {
  return window.localStorage.getItem(storageKey)
}

/**
 * 只在指针仍指向 runId 时才清除。用户可能已经开始了下一条任务，而上一条的
 * 结束回调这时才到；无条件清除会把新任务的入口一起抹掉。
 */
export function forgetActiveRun(runId: string): void {
  if (window.localStorage.getItem(storageKey) !== runId) return
  window.localStorage.removeItem(storageKey)
  broadcast()
}

/**
 * 只取判断"是否还在生成"所需的最小形状，不引 entities 的 WorkflowRun：
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
 * 按最新的工作流快照对齐指针。"进行中"取的是节点层面的生成态，与 Header 上
 * "有任务进行中"的说法同义；整条 Run 是否走完不在这里判断，那是用户自己的节奏。
 */
export function syncActiveRun(run: ActiveRunSnapshot | null): void {
  if (!run) return
  const generating = run.nodes.some(
    (node) => !node.deletedAt && node.status === 'active' && node.phase === 'generating',
  )
  if (generating) rememberActiveRun(run.id)
  else forgetActiveRun(run.id)
}

/** 订阅指针变化；同时覆盖本标签页写入和其他标签页的 `storage` 事件。 */
export function subscribeActiveRun(listener: () => void): () => void {
  window.addEventListener(changeEvent, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(changeEvent, listener)
    window.removeEventListener('storage', listener)
  }
}
