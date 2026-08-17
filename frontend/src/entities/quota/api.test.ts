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
  let client: ApiClient

  beforeEach(() => {
    request = vi.fn()
    client = {
      request: request as unknown as ApiClient['request'],
      requestList: vi.fn() as unknown as ApiClient['requestList'],
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

  it('拒绝缺字段或负数积分的响应', async () => {
    request.mockResolvedValue({ ...accountResponse, balance: -1 })

    await expect(createQuotaApis({ client }).getBalance()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
      message: '积分账户响应格式无效',
    })
  })

  it('默认适配器读取环境地址并携带当前登录凭证', async () => {
    vi.resetModules()
    const fetchFn = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 200, message: 'ok', data: accountResponse }), {
          status: 200,
        }),
      ),
    )
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
    vi.stubGlobal('fetch', fetchFn)
    const [{ registerApiAccessTokenProvider }, { quotaApis }] = await Promise.all([
      import('@/shared/api'),
      import('./api'),
    ])
    const unregister = registerApiAccessTokenProvider(() => 'access-token')

    try {
      await expect(quotaApis.getBalance()).resolves.toMatchObject({ balance: 90 })
      expect(fetchFn).toHaveBeenCalledWith(
        'https://api.windup.test/quota/balance',
        expect.objectContaining({
          headers: expect.objectContaining({}),
        }),
      )
      const request = fetchFn.mock.calls[0]?.[1]
      expect(new Headers(request?.headers).get('authorization')).toBe('Bearer access-token')
    } finally {
      unregister()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
