/** 真实现与 mock 共同遵守的请求形状。 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** 自动序列化并带 Content-Type。 */
  body?: unknown
  /** 值为 undefined 的键会被丢掉。 */
  query?: Record<string, string | number | boolean | undefined>
}
