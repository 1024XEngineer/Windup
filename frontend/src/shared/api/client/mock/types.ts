import type { RequestOptions } from '../types'

export type MockHandler = (options: RequestOptions, params: string[]) => unknown

export interface MockRoute {
  method: string
  /** 捕获组作为 params 传给 handler。 */
  pattern: RegExp
  handler: MockHandler
}
