import type { RequestOptions } from '../types'
import { projectMockHandlers } from './project-handlers'
import type { MockRoute } from './types'
import { workflowRunMockHandlers } from './workflow-run'

export type { MockHandler, MockRoute } from './types'

/**
 * mock 分发。与真实现形状一致，业务代码换实现不用改。
 * 后端接口到位后删掉对应 handler 即可，不必整体切换。
 */
const routes: MockRoute[] = [...projectMockHandlers, ...workflowRunMockHandlers]

/** 让加载态在开发时看得见；测试里不必等。 */
const MOCK_LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 200

export async function mockRequest<R>(path: string, options: RequestOptions): Promise<R> {
  const method = options.method ?? 'GET'
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS))

  for (const route of routes) {
    if (route.method !== method) continue
    const matched = route.pattern.exec(path)
    if (matched) return route.handler(options, matched.slice(1)) as R
  }
  throw new Error(`[mock] 尚未实现的接口：${method} ${path}`)
}
