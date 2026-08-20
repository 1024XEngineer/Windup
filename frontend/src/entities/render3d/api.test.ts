import { describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '@/shared/api'
import { createRender3DApis, render3DApis, Render3DContractError } from './api'

function clientReturning(data: unknown): { client: ApiClient; calls: string[] } {
  const calls: string[] = []
  const client: ApiClient = {
    request: vi.fn(async (path: string, options?: { method?: string }) => {
      calls.push(`${options?.method ?? 'GET'} ${path}`)
      return data
    }) as ApiClient['request'],
    requestList: vi.fn() as ApiClient['requestList'],
  }
  return { client, calls }
}

const ASSET = {
  asset_key: 'character-7/outfit-default',
  state: 'awaiting_review',
  model_3d_url: null,
  review_model_url: 'https://cdn.test/pending.glb',
  error: null,
  cost: {
    model3d_credits: 20,
    autorig_credits: 10,
    total_credits: 30,
    total_cny: 3.6,
    billing: 'postpaid',
    scope: 'per_outfit_once',
  },
}

const REPORT = {
  accepted: true,
  reject_code: null,
  detail: '母版 400×600',
  facts: {
    width: 400,
    height: 600,
    subject_ratio: 0.19,
    subject_area_ratio: 0.14,
    limb_segments: [2, 2, 2, 2],
    components: [33600],
  },
  warnings: [{ code: 'limbs_fused', detail: '两腿之间量不到空隙' }],
}

describe('三渲二资产适配器', () => {
  it('把后端的蛇形字段翻成实体形状', async () => {
    const { client } = clientReturning(ASSET)
    const asset = await createRender3DApis(client).getOutfitAsset('7', 'outfit-default')

    expect(asset.state).toBe('awaiting_review')
    expect(asset.reviewModelUrl).toBe('https://cdn.test/pending.glb')
    expect(asset.cost.totalCredits).toBe(30)
    expect(asset.cost.totalCny).toBe(3.6)
  })

  it('四个动作各自打到自己的路径上', async () => {
    const { client, calls } = clientReturning(ASSET)
    const apis = createRender3DApis(client)
    await apis.getOutfitAsset('7', 'outfit-default')
    await apis.buildOutfitAsset('7', 'outfit-default')
    await apis.approveOutfitAsset('7', 'outfit-default')
    await apis.discardOutfitAsset('7', 'outfit-default')

    expect(calls).toEqual([
      'GET /render3d/characters/7/outfits/outfit-default',
      'POST /render3d/characters/7/outfits/outfit-default/build',
      'POST /render3d/characters/7/outfits/outfit-default/approve',
      'POST /render3d/characters/7/outfits/outfit-default/discard',
    ])
  })

  it('认不出的状态直接拒收', async () => {
    const { client } = clientReturning({ ...ASSET, state: 'almost_done' })
    await expect(createRender3DApis(client).getOutfitAsset('7', 'a')).rejects.toBeInstanceOf(
      Render3DContractError,
    )
  })

  it('成本字段缺一个就拒收——界面拿它让用户做付费决定', async () => {
    const { total_cny: _dropped, ...partial } = ASSET.cost
    const { client } = clientReturning({ ...ASSET, cost: partial })
    await expect(createRender3DApis(client).getOutfitAsset('7', 'a')).rejects.toBeInstanceOf(
      Render3DContractError,
    )
  })

  it('预检结果带回量到的形态与警告', async () => {
    const { client } = clientReturning(REPORT)
    const report = await createRender3DApis(client).precheckMaster('https://cdn.test/m.png')

    expect(report.accepted).toBe(true)
    expect(report.facts?.limbSegments).toEqual([2, 2, 2, 2])
    expect(report.warnings).toEqual([{ code: 'limbs_fused', detail: '两腿之间量不到空隙' }])
  })

  it('通过却带着拒绝码属于后端两处判定分叉，必须拒收', async () => {
    // 放行的话界面会显示"这张可用"而建资产那一步拒收，用户只看到一个无从解释的失败。
    const { client } = clientReturning({ ...REPORT, reject_code: 'aspect_too_wide' })
    await expect(
      createRender3DApis(client).precheckMaster('https://cdn.test/m.png'),
    ).rejects.toBeInstanceOf(Render3DContractError)
  })

  it('被拒却没有拒绝码同样拒收', async () => {
    const { client } = clientReturning({ ...REPORT, accepted: false, facts: null, warnings: [] })
    await expect(
      createRender3DApis(client).precheckMaster('https://cdn.test/m.png'),
    ).rejects.toBeInstanceOf(Render3DContractError)
  })

  it('认不出的警告码拒收——界面会按码选文案，静默丢弃等于漏报', async () => {
    const { client } = clientReturning({
      ...REPORT,
      warnings: [{ code: 'has_text', detail: '画面里有文字' }],
    })
    await expect(
      createRender3DApis(client).precheckMaster('https://cdn.test/m.png'),
    ).rejects.toBeInstanceOf(Render3DContractError)
  })
})

describe('三渲二适配器的形状守卫', () => {
  // 这些分支挡的是"后端换了形状但没人发现"。放行的话,坏值会一路流到界面上:
  // 用户看到的是 NaN 积分或空白状态,而错误的来源在两层之外。
  async function precheckWith(payload: unknown) {
    const { client } = clientReturning(payload)
    return createRender3DApis(client).precheckMaster('https://cdn.test/master.png', {
      width: 64,
      height: 64,
    })
  }

  it('facts 不是对象时拒收', async () => {
    await expect(precheckWith({ ...REPORT, facts: 'not-an-object' })).rejects.toBeInstanceOf(
      Render3DContractError,
    )
  })

  it('量出来的尺寸不是有限数字时拒收', async () => {
    await expect(
      precheckWith({ ...REPORT, facts: { ...REPORT.facts, width: 'wide' } }),
    ).rejects.toBeInstanceOf(Render3DContractError)
  })

  it('limb_segments 不是数组时拒收', async () => {
    await expect(
      precheckWith({ ...REPORT, facts: { ...REPORT.facts, limb_segments: 3 } }),
    ).rejects.toBeInstanceOf(Render3DContractError)
  })

  it('limb_segments 里混进非数字时拒收', async () => {
    await expect(
      precheckWith({ ...REPORT, facts: { ...REPORT.facts, limb_segments: [1, '2'] } }),
    ).rejects.toBeInstanceOf(Render3DContractError)
  })

  it('warnings 不是数组时拒收', async () => {
    await expect(precheckWith({ ...REPORT, warnings: 'none' })).rejects.toBeInstanceOf(
      Render3DContractError,
    )
  })

  it('警告缺 detail 时拒收——界面要拿它告诉用户具体哪里不合格', async () => {
    await expect(
      precheckWith({ ...REPORT, warnings: [{ code: 'limbs_fused' }] }),
    ).rejects.toBeInstanceOf(Render3DContractError)
  })

  it('accepted 不是布尔值时拒收', async () => {
    await expect(precheckWith({ ...REPORT, accepted: 'yes' })).rejects.toBeInstanceOf(
      Render3DContractError,
    )
  })

  it('facts 缺席时是合法的——预检被拒时后端不量形态', async () => {
    const report = await precheckWith({
      ...REPORT,
      accepted: false,
      reject_code: 'aspect_too_wide',
      facts: null,
    })
    expect(report.facts).toBeNull()
  })

  it('认不出的拒绝码拒收——界面按码选文案，静默丢弃等于漏报', async () => {
    await expect(
      precheckWith({ ...REPORT, accepted: false, reject_code: 'no_such_reason' }),
    ).rejects.toBeInstanceOf(Render3DContractError)
  })

  it('整个预检结果不是对象时拒收', async () => {
    await expect(precheckWith(['报告'])).rejects.toBeInstanceOf(Render3DContractError)
  })
})

describe('render3DApis 单例', () => {
  // 单例是五个方法各自转发一次,新增方法时很容易只加在工厂上、忘了往这里挂 ——
  // 那样界面调用的是 undefined,而工厂的测试全绿。这条按端点逐个点名。
  it('五个方法都接到各自的端点上', async () => {
    const calls: string[] = []
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const path = String(url)
        calls.push(`${init?.method ?? 'GET'} ${path.slice(path.indexOf('/render3d'))}`)
        return new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: path.includes('master-precheck') ? REPORT : ASSET,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    await render3DApis.precheckMaster('https://cdn.test/master.png')
    await render3DApis.getOutfitAsset('7', 'outfit-default')
    await render3DApis.buildOutfitAsset('7', 'outfit-default')
    await render3DApis.approveOutfitAsset('7', 'outfit-default')
    await render3DApis.discardOutfitAsset('7', 'outfit-default')

    expect(calls).toEqual([
      'POST /render3d/master-precheck',
      'GET /render3d/characters/7/outfits/outfit-default',
      'POST /render3d/characters/7/outfits/outfit-default/build',
      'POST /render3d/characters/7/outfits/outfit-default/approve',
      'POST /render3d/characters/7/outfits/outfit-default/discard',
    ])
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
})
