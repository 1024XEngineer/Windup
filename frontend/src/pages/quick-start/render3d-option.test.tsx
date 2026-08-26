/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/entities', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/entities')
  return {
    ...actual,
    render3DApis: {
      precheckMaster: async () => ({}),
      getOutfitAsset: async () => ({
        state: 'absent',
        model3dUrl: null,
        reviewModelUrl: null,
        error: null,
        cost: {
          model3dCredits: 20,
          autorigCredits: 10,
          totalCredits: 30,
          billing: 'postpaid',
          scope: 'per_outfit_once',
        },
      }),
      buildOutfitAsset: async () => ({}),
      approveOutfitAsset: async () => ({}),
      discardOutfitAsset: async () => ({}),
      getBakeJob: async () => null,
      putBakeFrame: async () => 1,
      completeBake: async () => undefined,
      failBake: async () => undefined,
    },
  }
})

const { Render3DOption } = await import('./render3d-option')

afterEach(cleanup)

describe('Quick Start 的 3D 进阶入口', () => {
  it('默认折叠 —— 主线是「一句话跑完」，按次计费的重动作不该摊在主线上', () => {
    render(
      <Render3DOption
        session={{ getCharacterInfo: () => ({ characterId: '7', outfitId: 'outfit-default' }) }}
      />,
    )
    expect(screen.getByRole('button', { name: /建 3D 资产/ })).toBeTruthy()
    expect(screen.queryByRole('group', { name: '3D 资产' })).toBeNull()
  })

  it('展开后才出现资产面板', async () => {
    render(
      <Render3DOption
        session={{ getCharacterInfo: () => ({ characterId: '7', outfitId: 'outfit-default' }) }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /建 3D 资产/ }))
    expect(await screen.findByRole('group', { name: '3D 资产' })).toBeTruthy()
    expect(screen.getByText(/只支持双足人形/)).toBeTruthy()
  })

  it('还没有角色时不渲染 —— 没有 outfit 就没有可建的对象', () => {
    const { container } = render(<Render3DOption session={{ getCharacterInfo: () => null }} />)
    expect(container.textContent).toBe('')
  })
})
