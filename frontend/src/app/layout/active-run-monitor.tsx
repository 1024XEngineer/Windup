import { useEffect, useState } from 'react'

import {
  forgetActiveRun,
  isMissingActiveRunError,
  readActiveRun,
  subscribeActiveRun,
  syncActiveRun,
  type ActiveRunSnapshot,
} from '@/features/active-run'
import { quickStartService } from '@/pages/quick-start/service'

interface ActiveRunMonitorSession {
  getWorkflow(): ActiveRunSnapshot
  subscribe(listener: (run: ActiveRunSnapshot) => void): () => void
  resume(): Promise<ActiveRunSnapshot>
  dispose(): void
}

export interface ActiveRunMonitorService {
  open(runId: string): Promise<ActiveRunMonitorSession>
}

export interface ActiveRunMonitorProps {
  userId: string
  pathname: string
  service?: ActiveRunMonitorService
}

/**
 * Quick Start 离页后由产品外壳接管生成订阅，直到后端终态落进 WorkflowRun。
 * 当前任务页仍由页面自己的 session 持有，避免两个 Controller 同时写同一条 Run。
 */
export function ActiveRunMonitor({
  userId,
  pathname,
  service = quickStartService,
}: ActiveRunMonitorProps) {
  const [runId, setRunId] = useState(() => readActiveRun(userId))

  useEffect(() => {
    const refresh = () => setRunId(readActiveRun(userId))
    refresh()
    return subscribeActiveRun(userId, refresh)
  }, [userId])

  useEffect(() => {
    if (!runId || pathname === `/quick-start/${encodeURIComponent(runId)}`) return

    let active = true
    let session: ActiveRunMonitorSession | null = null
    let unsubscribe: () => void = () => undefined
    const isCurrent = () => active && readActiveRun(userId) === runId
    const sync = (snapshot: ActiveRunSnapshot) => {
      if (isCurrent()) syncActiveRun(userId, snapshot)
    }

    void service
      .open(runId)
      .then(async (nextSession) => {
        if (!isCurrent()) {
          nextSession.dispose()
          return
        }
        session = nextSession
        sync(nextSession.getWorkflow())
        if (!isCurrent()) {
          nextSession.dispose()
          session = null
          return
        }
        unsubscribe = nextSession.subscribe(sync)
        const resumed = await nextSession.resume()
        if (isCurrent()) sync(resumed)
      })
      .catch((error: unknown) => {
        if (active && isMissingActiveRunError(error)) forgetActiveRun(userId, runId)
      })

    return () => {
      active = false
      unsubscribe()
      session?.dispose()
    }
  }, [pathname, runId, service, userId])

  return null
}
