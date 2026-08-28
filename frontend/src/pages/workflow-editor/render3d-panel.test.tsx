/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MasterPrecheckReport, Render3DApis, Render3DAsset, Render3DMotion } from '@/entities'
import { Render3DAssetPanel } from './render3d-panel'

const COST: Render3DAsset['cost'] = {
  model3dCredits: 20,
  autorigCredits: 10,
  totalCredits: 30,
  billing: 'postpaid',
  scope: 'per_outfit_once',
}

function asset(overrides: Partial<Render3DAsset> = {}): Render3DAsset {
  return {
    state: 'absent',
    model3dUrl: null,
    reviewModelUrl: null,
    bakedMotions: [],
    bakeableMotions: ['walk', 'idle', 'jump'],
    error: null,
    cost: COST,
    ...overrides,
  }
}

function apis(current: Render3DAsset, overrides: Partial<Render3DApis> = {}): Render3DApis {
  return {
    precheckMaster: async () => ({}) as MasterPrecheckReport,
    getOutfitAsset: async () => current,
    buildOutfitAsset: async () => current,
    approveOutfitAsset: async () => current,
    addOutfitMotion: async () => current,
    discardOutfitAsset: async () => current,
    getBakeJob: async () => null,
    putBakeFrame: async () => 1,
    completeBake: async () => undefined,
    failBake: async () => undefined,
    ...overrides,
  }
}

function mount(current: Render3DAsset, extra: Partial<Render3DApis> = {}, precheck = null) {
  return render(
    <Render3DAssetPanel
      render3d={apis(current, extra)}
      characterId="7"
      outfitId="outfit-default"
      precheck={precheck}
      disabled={false}
    />,
  )
}

// 这个套件里多条用例渲同一个组件，不清干净会出现「找到多个同名元素」。
afterEach(cleanup)

describe('3D 资产面板', () => {
  it('金额与「只收一次」都从后端 cost 读，前端不硬编码', async () => {
    mount(asset())
    const build = await screen.findByRole('button', { name: '建 3D 资产' })
    expect(build.textContent).toContain('30 积分')
    fireEvent.click(build)
    const confirm = await screen.findByRole('group', { name: '确认建 3D 资产' })
    expect(confirm.textContent).toContain('图生 3D 20')
    expect(confirm.textContent).toContain('绑骨 10')
    expect(confirm.textContent).toContain('同一造型只收一次')
    expect(confirm.textContent).toContain('最多同时持有 2 个')
  })

  it('非双足不给点确认，并说明改法', async () => {
    const build = vi.fn(async () => asset())
    mount(asset(), { buildOutfitAsset: build })
    fireEvent.click(await screen.findByRole('button', { name: '建 3D 资产' }))
    fireEvent.click(await screen.findByDisplayValue('quadruped'))
    const confirm = screen.getByRole('button', { name: '确认扣费并建 3D 资产' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/无法绑定骨骼/)).toBeTruthy()
    expect(build).not.toHaveBeenCalled()
  })

  it('双足才把 stance 发出去', async () => {
    const build = vi.fn(async () => asset({ state: 'building' }))
    mount(asset(), { buildOutfitAsset: build })
    fireEvent.click(await screen.findByRole('button', { name: '建 3D 资产' }))
    fireEvent.click(screen.getByRole('button', { name: '确认扣费并建 3D 资产' }))
    await waitFor(() => expect(build).toHaveBeenCalledWith('7', 'outfit-default', 'biped'))
  })

  it('预检不过就不给建，并展示后端给的原因', async () => {
    const report: MasterPrecheckReport = {
      accepted: false,
      rejectCode: 'subject_too_small',
      detail: '主体只占画幅 3.1%，换一张再试。',
      facts: null,
      warnings: [],
    }
    render(
      <Render3DAssetPanel
        render3d={apis(asset())}
        characterId="7"
        outfitId="outfit-default"
        precheck={report}
        disabled={false}
      />,
    )
    const build = await screen.findByRole('button', { name: '建 3D 资产' })
    expect(build.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/主体只占画幅 3.1%/)).toBeTruthy()
  })

  it('awaiting_review 是人工闸：只有放行与弃掉，没有自动路径', async () => {
    const approve = vi.fn(async () => asset({ state: 'rigging' }))
    mount(asset({ state: 'awaiting_review', reviewModelUrl: 'https://cdn.test/x.glb' }), {
      approveOutfitAsset: approve,
    })
    expect(await screen.findByRole('button', { name: '放行并开始绑骨' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '弃掉待审模型' })).toBeTruthy()
    expect(approve).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '放行并开始绑骨' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('7', 'outfit-default'))
  })

  it('失败时展示后端文案，不在前端重拼', async () => {
    mount(asset({ state: 'failed', error: '模型含武器配件，绑骨会把剑一起绑上权重。' }))
    expect(await screen.findByText(/模型含武器配件/)).toBeTruthy()
  })

  it('资产就绪后能加动作，价签在点之前就给出', async () => {
    mount(asset({ state: 'ready', model3dUrl: 'https://x/m.glb', bakedMotions: ['walk'] }))
    const jump = await screen.findByRole('button', { name: '烘入跳跃，10 积分' })
    expect(jump.textContent).toContain('10 积分')
    expect(await screen.findByRole('button', { name: '烘入待机，10 积分' })).toBeTruthy()
  })

  it('已经烘过的动作点不动 —— 重复点就是重复付一次绑骨', async () => {
    const add = vi.fn(async () => asset({ state: 'ready' }))
    mount(asset({ state: 'ready', model3dUrl: 'https://x/m.glb', bakedMotions: ['walk'] }), {
      addOutfitMotion: add,
    })
    const walk = await screen.findByRole('button', { name: '走路已就绪' })
    expect((walk as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(walk)
    expect(add).not.toHaveBeenCalled()
  })

  it('点一个没烘过的动作，把动作名传给后端', async () => {
    // 形参要写出来:不写的话 mock.calls 的元组类型是 [],下面那句取 [2] 连编译都过不了,
    // 而"动作名传错"正是这条用例唯一要拦的东西。
    const add = vi.fn(async (_characterId: string, _outfitId: string, _motion: Render3DMotion) =>
      asset({ state: 'ready' }),
    )
    mount(asset({ state: 'ready', model3dUrl: 'https://x/m.glb', bakedMotions: [] }), {
      addOutfitMotion: add,
    })
    fireEvent.click(await screen.findByRole('button', { name: '烘入跳跃，10 积分' }))
    await waitFor(() => expect(add).toHaveBeenCalled())
    // 拿错动作名 = 花了钱烘出另一个动作，而界面照样显示成功。
    expect(add.mock.calls[0]?.[2]).toBe('jump')
  })

  it('扣费数字取后端返回的那份，前端不另存一个价', async () => {
    // 前端另存一份常量的话，改价那天界面会理直气壮地报一个错数，而且哪一道闸都不红。
    // 所以这里故意给一个不等于历史硬编码值(10)的价。
    mount(
      asset({
        state: 'ready',
        model3dUrl: 'https://x/m.glb',
        bakedMotions: [],
        cost: { ...COST, autorigCredits: 17 },
      }),
    )
    await screen.findByRole('button', { name: '烘入跳跃，17 积分' })
    expect(screen.queryByRole('button', { name: /10 积分/ })).toBeNull()
  })

  it('可烘动作由后端给，前端不自己列 —— 后端没给就一个都不显示', async () => {
    mount(asset({ state: 'ready', model3dUrl: 'https://x/m.glb', bakeableMotions: [] }))
    await screen.findByText(/一份绑骨产物只带一个动作/)
    expect(screen.queryByRole('button', { name: /烘入/ })).toBeNull()
  })
})
