import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '@/shared/api'

import { createQuotaApis } from './api'

const balanceResponse = {
  id: 1,
  user_id: 7,
  balance: 128,
  frozen: 10,
  total_earned: 200,
  total_spent: 72,
  create_at: '2026-08-01T01:02:03Z',
  update_at: '2026-08-07T01:02:03Z',
}

const transactionResponse = {
  id: 11,
  user_id: 7,
  delta: -12,
  reason: 8,
  billing_mode: 0,
  ref_id: 'gen-42',
  balance_after: 116,
  create_at: '2026-08-07T01:02:03Z',
}

describe('createQuotaApis', () => {
  let request: ReturnType<typeof vi.fn>
  let requestList: ReturnType<typeof vi.fn>
  let client: ApiClient

  beforeEach(() => {
    request = vi.fn()
    requestList = vi.fn()
    client = {
      request: request as unknown as ApiClient['request'],
      requestList: requestList as unknown as ApiClient['requestList'],
    }
  })

  it('maps the balance command to /quota/balance and converts the account payload', async () => {
    request.mockResolvedValue(balanceResponse)
    const apis = createQuotaApis({ client })

    await expect(apis.getBalance()).resolves.toEqual({
      id: '1',
      userId: '7',
      balance: 128,
      frozen: 10,
      totalEarned: 200,
      totalSpent: 72,
      createdAt: '2026-08-01T01:02:03Z',
      updatedAt: '2026-08-07T01:02:03Z',
    })
    expect(request).toHaveBeenCalledWith('/quota/balance')
  })

  it('maps the transactions command to /quota/transactions with pagination and converts rows', async () => {
    requestList.mockResolvedValue({
      items: [transactionResponse],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const apis = createQuotaApis({ client })

    await expect(apis.listTransactions({ page: 2, pageSize: 20 })).resolves.toEqual({
      items: [
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
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    expect(requestList).toHaveBeenCalledWith('/quota/transactions', {
      query: { page: 2, page_size: 20 },
    })
  })

  it.each([
    ['missing id', { ...balanceResponse, id: null }],
    ['missing balance', { ...balanceResponse, balance: '128' }],
  ])('rejects a successful balance response with %s', async (_label, response) => {
    request.mockResolvedValue(response)
    const apis = createQuotaApis({ client })

    await expect(apis.getBalance()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it.each([
    ['unknown reason', { ...transactionResponse, reason: 99 }],
    ['missing delta', { ...transactionResponse, delta: null }],
  ])('rejects a successful transaction row with %s', async (_label, response) => {
    requestList.mockResolvedValue({
      items: [response],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const apis = createQuotaApis({ client })

    await expect(apis.listTransactions()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('recovers and replays protected quota requests after unauthorized', async () => {
    const recover = vi.fn(async () => true)
    const unregister = await import('@/shared/api').then(({ registerApiUnauthorizedRecovery }) =>
      registerApiUnauthorizedRecovery(recover),
    )
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 401, message: 'access token expired', data: null }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, message: 'ok', data: balanceResponse }), {
          status: 200,
        }),
      )
    const apis = createQuotaApis({ baseUrl: 'https://api.windup.test', fetchFn })

    try {
      await expect(apis.getBalance()).resolves.toMatchObject({ balance: 128 })
      expect(recover).toHaveBeenCalledTimes(1)
      expect(fetchFn).toHaveBeenCalledTimes(2)
    } finally {
      unregister()
    }
  })
})
