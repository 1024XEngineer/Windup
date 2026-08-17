import { useCallback, useEffect, useState } from 'react'

import type { CreditAccount, CreditTransaction, QuotaApis } from '@/entities'
import { quotaApis } from '@/entities'

const TRANSACTIONS_PAGE_SIZE = 20

export type QuotaBalanceStatus = 'loading' | 'ready' | 'error'

export interface QuotaBalanceState {
  status: QuotaBalanceStatus
  account: CreditAccount | null
  error: string | null
  reload(): void
}

type QuotaBalanceResult =
  | { status: 'loading'; account: null; error: null }
  | { status: 'ready'; account: CreditAccount; error: null }
  | { status: 'error'; account: null; error: string }

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '积分加载失败，请稍后重试'
}

/** 查询当前用户积分余额；enabled=false 时不发起请求，用于访客态。 */
export function useQuotaBalance(enabled: boolean, apis: QuotaApis = quotaApis): QuotaBalanceState {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<QuotaBalanceResult>({
    status: 'loading',
    account: null,
    error: null,
  })

  useEffect(() => {
    if (!enabled) return
    let active = true
    setResult({ status: 'loading', account: null, error: null })
    // createApiClient 可能在配置缺失时同步抛错，放进微任务再进入统一的错误分支。
    void Promise.resolve()
      .then(() => apis.getBalance())
      .then(
        (account) => {
          if (active) setResult({ status: 'ready', account, error: null })
        },
        (error: unknown) => {
          if (active) setResult({ status: 'error', account: null, error: errorMessage(error) })
        },
      )
    return () => {
      active = false
    }
  }, [apis, attempt, enabled])

  const reload = useCallback(() => setAttempt((current) => current + 1), [])

  return { ...result, reload }
}

export type QuotaTransactionsStatus = 'loading' | 'ready' | 'error'

export interface QuotaTransactionsState {
  status: QuotaTransactionsStatus
  transactions: CreditTransaction[]
  total: number
  page: number
  pageSize: number
  error: string | null
  loadPage(page: number): void
  reload(): void
}

type QuotaTransactionsResult = {
  status: QuotaTransactionsStatus
  transactions: CreditTransaction[]
  total: number
  page: number
  pageSize: number
  error: string | null
}

const initialTransactionsResult: QuotaTransactionsResult = {
  status: 'loading',
  transactions: [],
  total: 0,
  page: 1,
  pageSize: TRANSACTIONS_PAGE_SIZE,
  error: null,
}

/** 分页查询当前用户积分流水；enabled=false 时不发起请求。 */
export function useQuotaTransactions(
  enabled: boolean,
  apis: QuotaApis = quotaApis,
): QuotaTransactionsState {
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<QuotaTransactionsResult>(initialTransactionsResult)

  useEffect(() => {
    if (!enabled) return
    let active = true
    setResult((current) => ({ ...current, status: 'loading', error: null }))
    void Promise.resolve()
      .then(() => apis.listTransactions({ page, pageSize: TRANSACTIONS_PAGE_SIZE }))
      .then(
        (paged) => {
          if (active) {
            setResult({
              status: 'ready',
              transactions: paged.items,
              total: paged.total,
              page: paged.page,
              pageSize: paged.pageSize,
              error: null,
            })
          }
        },
        (error: unknown) => {
          if (active)
            setResult((current) => ({ ...current, status: 'error', error: errorMessage(error) }))
        },
      )
    return () => {
      active = false
    }
  }, [apis, attempt, enabled, page])

  const loadPage = useCallback((nextPage: number) => setPage(Math.max(1, nextPage)), [])
  const reload = useCallback(() => {
    setPage(1)
    setAttempt((current) => current + 1)
  }, [])

  return { ...result, loadPage, reload }
}

const creditDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** 流水时间展示；无效值返回「时间未知」。 */
export function formatCreditDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return creditDateTimeFormatter.format(date)
}
