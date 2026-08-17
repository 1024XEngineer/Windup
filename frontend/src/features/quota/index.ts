import { useCallback, useEffect, useState } from 'react'

import { quotaApis as defaultQuotaApis } from '@/entities'
import type { CreditAccount, CreditTransaction, QuotaApis } from '@/entities'

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
  const [requestedPage, setRequestedPage] = useState(1)
  const [result, setResult] = useState<TransactionsResult>(initialTransactions)

  useEffect(() => {
    if (!enabled) {
      setResult(initialTransactions)
      return
    }

    let active = true
    setResult((current) => ({ ...current, status: 'loading', error: null }))
    void Promise.resolve()
      .then(() => apis.listTransactions({ page: requestedPage, pageSize: TRANSACTIONS_PAGE_SIZE }))
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
  }, [apis, attempt, enabled, requestedPage])

  const loadPage = useCallback((page: number) => setRequestedPage(Math.max(1, page)), [])
  const reload = useCallback(() => setAttempt((current) => current + 1), [])
  return { ...result, loadPage, reload }
}

const reasonLabels: Readonly<Record<number, string>> = {
  1: '注册赠送',
  2: '邀请奖励',
  3: '生成角色参考图',
  4: '生成角色动作',
  5: '管理员调整',
  6: '退款 / 回退',
  7: '积分冻结',
  8: '实际扣减',
}

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
