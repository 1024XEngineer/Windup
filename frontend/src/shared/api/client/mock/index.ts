import type { RequestOptions } from '../types'
import { projectMockHandlers } from './project-handlers'
import type { MockRoute } from './types'

export type { MockHandler, MockRoute } from './types'

/**
 * Project 假 HTTP 的过渡分发，与真实响应壳保持一致。
 * 当前开关仍是全局的，删除单个 handler 不会让该路径自动改走真实接口；新增业务能力应使用
 * 能力级 Port/Adapter，不继续扩充这张路由表。
 */
const routes: MockRoute[] = [...projectMockHandlers]

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
