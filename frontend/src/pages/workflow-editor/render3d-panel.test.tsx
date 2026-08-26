/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MasterPrecheckReport, Render3DApis, Render3DAsset } from '@/entities'
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
})
