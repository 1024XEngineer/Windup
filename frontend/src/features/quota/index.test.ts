// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CreditAccount, QuotaApis } from '@/entities'

import { useQuotaBalance, useQuotaTransactions } from '.'

const account: CreditAccount = {
  id: '11',
  userId: '7',
  balance: 90,
  frozen: 10,
  totalEarned: 150,
  totalSpent: 50,
  createdAt: '2026-08-12T01:02:03Z',
  updatedAt: '2026-08-17T01:02:03Z',
}

function createQuotaApis(): QuotaApis & {
  getBalance: ReturnType<typeof vi.fn>
  listTransactions: ReturnType<typeof vi.fn>
} {
  return {
    getBalance: vi.fn(async () => account),
    listTransactions: vi.fn(async ({ page = 1, pageSize = 20 } = {}) => ({
      items: [
        {
          id: '21',
          userId: '7',
          delta: -12,
          reason: 8,
          billingMode: 0,
          refId: 'generation-42',
          balanceAfter: 78,
          createdAt: '2026-08-17T02:03:04Z',
        },
      ],
      total: 41,
      page,
      pageSize,
    })),
  }
}

describe('quota queries', () => {
  it('只在启用时查询余额并保留判别状态', async () => {
    const apis = createQuotaApis()
    const { result, rerender } = renderHook(({ enabled }) => useQuotaBalance(enabled, apis), {
      initialProps: { enabled: false },
    })

    expect(result.current).toMatchObject({ status: 'idle', account: null })
    expect(apis.getBalance).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    if (result.current.status !== 'ready') throw new Error('余额状态未进入 ready')
    expect(result.current.account.balance).toBe(90)
  })

  it('余额失败后允许用户重试', async () => {
    const apis = createQuotaApis()
    apis.getBalance
      .mockRejectedValueOnce(new Error('积分服务不可用'))
      .mockResolvedValueOnce(account)
    const { result } = renderHook(() => useQuotaBalance(true, apis))

    await waitFor(() => expect(result.current.status).toBe('error'))
    if (result.current.status !== 'error') throw new Error('余额状态未进入 error')
    expect(result.current.error).toBe('积分服务不可用')

    act(() => result.current.reload())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(apis.getBalance).toHaveBeenCalledTimes(2)
  })

  it('切换页码后读取对应的积分流水', async () => {
    const apis = createQuotaApis()
    const { result } = renderHook(() => useQuotaTransactions(true, apis))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(apis.listTransactions).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 })

    act(() => result.current.loadPage(2))
    await waitFor(() =>
      expect(apis.listTransactions).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 }),
    )
    await waitFor(() => expect(result.current.page).toBe(2))
  })

  it('组件卸载后忽略迟到的余额结果', async () => {
    const apis = createQuotaApis()
    let resolveBalance!: (value: CreditAccount) => void
    apis.getBalance.mockReturnValue(
      new Promise<CreditAccount>((resolve) => {
        resolveBalance = resolve
      }),
    )
    const { result, unmount } = renderHook(() => useQuotaBalance(true, apis))

    await waitFor(() => expect(result.current.status).toBe('loading'))
    unmount()
    resolveBalance(account)
    await Promise.resolve()

    expect(apis.getBalance).toHaveBeenCalledTimes(1)
  })
})
