import type { RequestOptions } from '../types'

export type MockHandler = (options: RequestOptions, params: string[]) => unknown

export interface MockRoute {
  /** 要匹配的 HTTP 方法，使用大写字符串。 */
  method: string
  /** 捕获组作为 params 传给 handler。 */
  pattern: RegExp
  /** 匹配成功后生成后端原始响应数据的处理函数。 */
  handler: MockHandler
}
