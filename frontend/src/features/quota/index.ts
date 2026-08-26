import { useCallback, useEffect, useState } from 'react'

import { quotaApis as defaultQuotaApis } from '@/entities'
import type {
  CreditAccount,
  CreditTransaction,
  QuotaApis,
  QuotaTransactionFilters,
  QuotaTransactionPageQuery,
} from '@/entities'

const TRANSACTIONS_PAGE_SIZE = 20

type BalanceResult =
  | { status: 'idle' | 'loading'; account: null; error: null }
  | { status: 'ready'; account: CreditAccount; error: null }
  | { status: 'error'; account: null; error: string }

export type QuotaBalanceState = BalanceResult & { reload(): void }

type TransactionsResult = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  transactions: CreditTransaction[]
  total: number
  page: number
  pageSize: number
  error: string | null
}

export type QuotaTransactionsState = TransactionsResult & {
  loadPage(page: number): void
  setPageSize(pageSize: number): void
  applyFilters(filters: QuotaTransactionFilters, pageSize?: number): void
  reload(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '积分加载失败，请稍后重试'
}

export function useQuotaBalance(
  enabled: boolean,
  apis: QuotaApis = defaultQuotaApis,
): QuotaBalanceState {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<BalanceResult>({
    status: 'idle',
    account: null,
    error: null,
  })

  useEffect(() => {
    if (!enabled) {
      setResult({ status: 'idle', account: null, error: null })
      return
    }

    let active = true
    setResult({ status: 'loading', account: null, error: null })
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

const initialTransactions: TransactionsResult = {
  status: 'idle',
  transactions: [],
  total: 0,
  page: 1,
  pageSize: TRANSACTIONS_PAGE_SIZE,
  error: null,
}

export function useQuotaTransactions(
  enabled: boolean,
  apis: QuotaApis = defaultQuotaApis,
): QuotaTransactionsState {
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState<QuotaTransactionPageQuery>({
    page: 1,
    pageSize: TRANSACTIONS_PAGE_SIZE,
  })
  const [result, setResult] = useState<TransactionsResult>(initialTransactions)

  useEffect(() => {
    if (!enabled) {
      setResult(initialTransactions)
      return
    }

    let active = true
    setResult((current) => ({ ...current, status: 'loading', error: null }))
    void Promise.resolve()
      .then(() => apis.listTransactions(query))
      .then(
        (page) => {
          if (!active) return
          setResult({
            status: 'ready',
            transactions: page.items,
            total: page.total,
            page: page.page,
            pageSize: page.pageSize,
            error: null,
          })
        },
        (error: unknown) => {
          if (active) {
            setResult((current) => ({
              ...current,
              status: 'error',
              error: errorMessage(error),
            }))
          }
        },
      )

    return () => {
      active = false
    }
  }, [apis, attempt, enabled, query])

  const loadPage = useCallback(
    (page: number) => setQuery((current) => ({ ...current, page: Math.max(1, page) })),
    [],
  )
  const setPageSize = useCallback(
    (pageSize: number) =>
      setQuery((current) => ({ ...current, page: 1, pageSize: Math.max(1, pageSize) })),
    [],
  )
  const applyFilters = useCallback((filters: QuotaTransactionFilters, pageSize?: number) => {
    setQuery((current) => ({
      page: 1,
      pageSize: pageSize ?? current.pageSize,
      ...filters,
    }))
  }, [])
  const reload = useCallback(() => setAttempt((current) => current + 1), [])
  return { ...result, loadPage, setPageSize, applyFilters, reload }
}

export const CREDIT_REASON_OPTIONS = [
  { value: 1, label: '注册赠送' },
  { value: 2, label: '邀请奖励' },
  { value: 3, label: '生成角色参考图' },
  { value: 4, label: '生成角色动作' },
  { value: 5, label: '管理员调整' },
  { value: 6, label: '退款 / 回退' },
  { value: 7, label: '积分冻结' },
  { value: 8, label: '实际扣减' },
  { value: 9, label: '兑换码入账' },
] as const

const reasonLabels: Readonly<Record<number, string>> = Object.fromEntries(
  CREDIT_REASON_OPTIONS.map(({ value, label }) => [value, label]),
)

export function getCreditReasonLabel(reason: number): string {
  return reasonLabels[reason] ?? `积分变动（原因码 ${reason}）`
}

const creditDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatCreditDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : creditDateTimeFormatter.format(date)
}
