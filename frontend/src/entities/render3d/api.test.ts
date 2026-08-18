import { describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '@/shared/api'
import { createRender3DApis, Render3DContractError } from './api'

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
