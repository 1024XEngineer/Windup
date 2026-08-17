import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '@/shared/api'

import { createQuotaApis } from './api'

const accountResponse = {
  id: 11,
  user_id: 7,
  balance: 90,
  frozen: 10,
  total_earned: 150,
  total_spent: 50,
  create_at: '2026-08-12T01:02:03Z',
  update_at: '2026-08-17T01:02:03Z',
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

  it('从后端积分余额接口读取并映射账户', async () => {
    request.mockResolvedValue(accountResponse)

    await expect(createQuotaApis({ client }).getBalance()).resolves.toEqual({
      id: '11',
      userId: '7',
      balance: 90,
      frozen: 10,
      totalEarned: 150,
      totalSpent: 50,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    expect(request).toHaveBeenCalledWith('/quota/balance')
  })

  it('分页读取积分流水并保留后端原因码', async () => {
    requestList.mockResolvedValue({
      items: [
        {
          id: 21,
          user_id: 7,
          delta: -12,
          reason: 8,
          billing_mode: 0,
          ref_id: 'generation-42',
          balance_after: 78,
          create_at: '2026-08-17T02:03:04Z',
        },
      ],
      total: 41,
      page: 2,
      pageSize: 20,
    })

    await expect(
      createQuotaApis({ client }).listTransactions({ page: 2, pageSize: 20 }),
    ).resolves.toEqual({
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
      page: 2,
      pageSize: 20,
    })
    expect(requestList).toHaveBeenCalledWith('/quota/transactions', {
      query: { page: 2, page_size: 20 },
    })
  })

  it('读取并映射当前用户的邀请码', async () => {
    request.mockResolvedValue({
      code: 'AB23CD45',
      used_count: 3,
      create_at: '2026-08-12T01:02:03Z',
      update_at: '2026-08-17T01:02:03Z',
    })

    await expect(createQuotaApis({ client }).getInviteCode()).resolves.toEqual({
      code: 'AB23CD45',
      usedCount: 3,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })
    expect(request).toHaveBeenCalledWith('/quota/invite/code')
  })

  it('轮换邀请码并提交补填请求', async () => {
    request
      .mockResolvedValueOnce({
        code: 'XY89KL23',
        used_count: 3,
        create_at: '2026-08-12T01:02:03Z',
        update_at: '2026-08-17T03:00:00Z',
      })
      .mockResolvedValueOnce(null)

    const apis = createQuotaApis({ client })
    await expect(apis.generateInviteCode()).resolves.toMatchObject({
      code: 'XY89KL23',
      usedCount: 3,
    })
    await expect(apis.redeemInviteCode('AB23CD45')).resolves.toBeUndefined()
    expect(request).toHaveBeenNthCalledWith(1, '/quota/invite/generate', { method: 'POST' })
    expect(request).toHaveBeenNthCalledWith(2, '/quota/invite/redeem', {
      method: 'POST',
      json: { code: 'AB23CD45' },
    })
  })

  it('默认适配器读取环境地址并携带当前登录凭证', async () => {
    vi.resetModules()
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      const body = url.includes('/quota/transactions')
        ? {
            code: 200,
            message: 'ok',
            data: [],
            total: 0,
            page: 1,
            page_size: 20,
          }
        : { code: 200, message: 'ok', data: accountResponse }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', fetchFn)
    const [{ registerApiAccessTokenProvider }, { quotaApis }] = await Promise.all([
      import('@/shared/api'),
      import('./api'),
    ])
    const unregister = registerApiAccessTokenProvider(() => 'access-token')

    try {
      await expect(quotaApis.getBalance()).resolves.toMatchObject({ balance: 90 })
      await expect(quotaApis.listTransactions({ page: 1, pageSize: 20 })).resolves.toMatchObject({
        items: [],
        total: 0,
      })
      expect(fetchFn).toHaveBeenCalledWith(
        'https://api.windup.test/quota/balance',
        expect.objectContaining({
          headers: expect.objectContaining({}),
        }),
      )
      const request = fetchFn.mock.calls[0]?.[1]
      expect(new Headers(request?.headers).get('authorization')).toBe('Bearer access-token')
      expect(fetchFn.mock.calls[1]?.[0]).toBe(
        'https://api.windup.test/quota/transactions?page=1&page_size=20',
      )
    } finally {
      unregister()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
