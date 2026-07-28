import { useEffect, useState } from 'react'

/**
 * entities 层所有 useXxx 的返回形状。
 * 自己定义而不直接暴露某个请求库的类型，是为了以后换实现时页面不用改。
 */
export interface AsyncState<T> {
  /** 最近一次成功取得的数据；首次完成前或尚无数据时为 null。 */
  data: T | null
  /** 首次加载或 refresh 触发的请求进行中时为 true。 */
  loading: boolean
  /** 最近一次请求失败的 Error；加载开始和成功后为 null。 */
  error: Error | null
  /** 失败重试或外部操作后刷新。 */
  refresh: () => void
}

/** deps 变化时重拉；旧请求结果会被丢弃，避免慢请求覆盖新数据。 */
export function useAsync<T>(factory: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)
    factory()
      .then((result) => {
        if (!stale) setData(result)
      })
      .catch((cause: unknown) => {
        if (!stale) setError(cause instanceof Error ? cause : new Error(String(cause)))
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
    // factory 每次渲染都是新函数，依赖由调用方经 deps 声明
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { data, loading, error, refresh: () => setTick((n) => n + 1) }
}
