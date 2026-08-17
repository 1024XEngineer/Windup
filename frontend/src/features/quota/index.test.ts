// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'

import type { CreditAccount, CreditTransaction, QuotaApis } from '@/entities'

import { formatCreditDateTime, useQuotaBalance, useQuotaTransactions } from '.'

const account: CreditAccount = {
  id: '1',
  userId: '7',
  balance: 128,
  frozen: 10,
  totalEarned: 200,
  totalSpent: 72,
  createdAt: '2026-08-01T01:02:03Z',
  updatedAt: '2026-08-07T01:02:03Z',
}

const transactions: CreditTransaction[] = [
  {
    id: '11',
    userId: '7',
    delta: -12,
    reason: 'captured',
    billingMode: 'prepaid',
    refId: 'gen-42',
    balanceAfter: 116,
    createdAt: '2026-08-07T01:02:03Z',
  },
]

function createApis() {
  return {
    getBalance: vi.fn(async () => account),
    listTransactions: vi.fn(async () => ({
      items: transactions,
      total: 1,
      page: 1,
      pageSize: 20,
    })),
  } satisfies QuotaApis
}

describe('useQuotaBalance', () => {
  it('loads the balance when enabled and exposes it as ready', async () => {
    const apis = createApis()
    const { result } = renderHook(() => useQuotaBalance(true, apis))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.account).toEqual(account)
    expect(result.current.error).toBeNull()
    expect(apis.getBalance).toHaveBeenCalledTimes(1)
  })

  it('does not issue a request while disabled', () => {
    const apis = createApis()
    const { result } = renderHook(() => useQuotaBalance(false, apis))

    expect(result.current.status).toBe('loading')
    expect(apis.getBalance).not.toHaveBeenCalled()
  })

  it('reports a readable error instead of throwing when the request fails', async () => {
    const apis = createApis()
    apis.getBalance.mockRejectedValue(new Error('积分服务不可用'))
    const { result } = renderHook(() => useQuotaBalance(true, apis))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.account).toBeNull()
    expect(result.current.error).toBe('积分服务不可用')
  })

  it('treats a synchronous failure as an error state too', async () => {
    const apis = createApis()
    apis.getBalance.mockImplementation(() => {
      throw new Error('API 地址未配置')
    })
    const { result } = renderHook(() => useQuotaBalance(true, apis))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('API 地址未配置')
  })

  it('refetches after reload', async () => {
    const apis = createApis()
    const { result } = renderHook(() => useQuotaBalance(true, apis))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() => result.current.reload())

    await waitFor(() => expect(apis.getBalance).toHaveBeenCalledTimes(2))
    expect(result.current.status).toBe('ready')
  })
})

describe('useQuotaTransactions', () => {
  it('loads the first page of transactions when enabled', async () => {
    const apis = createApis()
    const { result } = renderHook(() => useQuotaTransactions(true, apis))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.transactions).toEqual(transactions)
    expect(result.current.total).toBe(1)
    expect(apis.listTransactions).toHaveBeenCalledWith({ page: 1, pageSize: 20 })
  })

  it('loads a requested page', async () => {
    const apis = createApis()
    const { result } = renderHook(() => useQuotaTransactions(true, apis))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() => result.current.loadPage(3))

    await waitFor(() =>
      expect(apis.listTransactions).toHaveBeenLastCalledWith({ page: 3, pageSize: 20 }),
    )
  })

  it('does not issue a request while disabled', () => {
    const apis = createApis()
    const { result } = renderHook(() => useQuotaTransactions(false, apis))

    expect(result.current.status).toBe('loading')
    expect(apis.listTransactions).not.toHaveBeenCalled()
  })

  it('reports a readable error when the request fails', async () => {
    const apis = createApis()
    apis.listTransactions.mockRejectedValue(new Error('流水读取失败'))
    const { result } = renderHook(() => useQuotaTransactions(true, apis))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('流水读取失败')
  })
})

describe('formatCreditDateTime', () => {
  it('formats an ISO timestamp in zh-CN', () => {
    const formatted = formatCreditDateTime('2026-08-07T01:02:03Z')
    expect(formatted).toContain('2026')
    expect(formatted).toContain('08')
  })

  it('returns a stable fallback for invalid values', () => {
    expect(formatCreditDateTime('not-a-date')).toBe('时间未知')
  })
})
