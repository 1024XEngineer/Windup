/**
 * 将不可信的回跳值收窄为当前站点的绝对路径。
 * 双斜杠与反斜杠在不同 URL 解析器里可能被当作外部主机，因此在解析前直接拒绝。
 */
export function sanitizeInternalPath(value: string | null, origin?: string): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null
  }

  const currentOrigin = origin ?? globalThis.location?.origin
  if (!currentOrigin) return null

  try {
    const expectedOrigin = new URL(currentOrigin).origin
    const parsed = new URL(value, expectedOrigin)
    if (parsed.origin !== expectedOrigin) return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}
