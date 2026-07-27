/** 通用测试辅助工具。业务无关，各层测试共用。 */

/** 等一个 tick，让 mock 的延迟与 React 状态更新落地。 */
export function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
