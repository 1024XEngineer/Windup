import { afterEach, describe, expect, it, vi } from 'vitest'

import { actionPresetApis, ActionPresetContractError } from '@/entities'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ActionPresetApis.list', () => {
  it('读 /action-presets 并按后端字段原样交付', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        listResponse([
          { type: 'idle', label: 'Idle 待机', name: '待机', description: '呼吸带动胸腔起伏' },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(actionPresetApis.list()).resolves.toEqual([
      { type: 'idle', label: 'Idle 待机', name: '待机', description: '呼吸带动胸腔起伏' },
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8000/action-presets')
  })

  it('缺字段的预设按契约错误抛出，不交付半份文案', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(listResponse([{ type: 'idle', label: 'Idle 待机', name: '待机' }])),
    )

    await expect(actionPresetApis.list()).rejects.toBeInstanceOf(ActionPresetContractError)
  })

  it('空表也算契约错误——空菜单与接口挂了在界面上没有区别', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(listResponse([])))

    await expect(actionPresetApis.list()).rejects.toBeInstanceOf(ActionPresetContractError)
  })
})

function listResponse(data: unknown[]): Response {
  return new Response(
    JSON.stringify({
      code: 200,
      message: 'success',
      data,
      total: data.length,
      page: 1,
      page_size: 0,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
