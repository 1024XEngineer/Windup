// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import type { QuotaApis } from '@/entities'
import { InviteSection } from './index'

function createApis(): QuotaApis & Record<keyof QuotaApis, ReturnType<typeof vi.fn>> {
  return {
    getBalance: vi.fn(async () => ({
      id: '11',
      userId: '7',
      balance: 100,
      frozen: 0,
      totalEarned: 100,
      totalSpent: 0,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })),
    listTransactions: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    getInviteCode: vi.fn(async () => ({
      code: 'AB23CD45',
      usedCount: 2,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })),
    generateInviteCode: vi.fn(async () => ({
      code: 'XY89KL23',
      usedCount: 2,
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T03:00:00Z',
    })),
    redeemInviteCode: vi.fn(async () => undefined),
  }
}

function renderInvite(apis = createApis()) {
  return {
    apis,
    ...render(
      <MemoryRouter>
        <InviteSection apis={apis} />
      </MemoryRouter>,
    ),
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('InviteSection', () => {
  it('把分享邀请链接和人物放进同一个主模块', async () => {
    renderInvite()

    const feature = await screen.findByTestId('invite-feature')
    const character = screen.getByTestId('invite-character')
    expect(feature.contains(character)).toBe(true)
    expect(feature.contains(screen.getByRole('button', { name: '复制邀请链接' }))).toBe(true)
    expect(feature.className).not.toContain('bg-app-accent-soft')
    expect(character.className).toContain('invite-character-artwork')
  })

  it('展示邀请事实并复制邀请码与注册链接', async () => {
    renderInvite()

    expect(await screen.findByText('AB23CD45')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('100')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '复制邀请码' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('AB23CD45'))
    expect(await screen.findByText('邀请码已复制')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }))
    const expectedLink = `${window.location.origin}/?account=register&invite=AB23CD45&returnTo=%2Fworkspace`
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink))
    expect(await screen.findByText('邀请链接已复制')).toBeTruthy()
  })

  it('保持邀请码稳定，不提供轮换入口', async () => {
    renderInvite()

    expect(await screen.findByText('AB23CD45')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /更换邀请码|确认更换/ })).toBeNull()
  })

  it('补填邀请码后刷新积分，并保留清晰的成功结果', async () => {
    const apis = createApis()
    apis.getBalance
      .mockResolvedValueOnce({
        id: '11',
        userId: '7',
        balance: 100,
        frozen: 0,
        totalEarned: 100,
        totalSpent: 0,
        createdAt: '2026-08-12T01:02:03Z',
        updatedAt: '2026-08-17T01:02:03Z',
      })
      .mockResolvedValue({
        id: '11',
        userId: '7',
        balance: 150,
        frozen: 0,
        totalEarned: 150,
        totalSpent: 0,
        createdAt: '2026-08-12T01:02:03Z',
        updatedAt: '2026-08-17T03:00:00Z',
      })

    renderInvite(apis)
    expect(await screen.findByText('100')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('补填邀请码'), { target: { value: 'mn67pq89' } })
    fireEvent.click(screen.getByRole('button', { name: '确认补填' }))

    await waitFor(() => expect(apis.redeemInviteCode).toHaveBeenCalledWith('MN67PQ89'))
    expect(await screen.findByText('邀请奖励已到账')).toBeTruthy()
    await waitFor(() => expect(apis.getBalance).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('150')).toBeTruthy()
  })

  it('复制失败时给出可恢复提示', async () => {
    const clipboardError = new Error('clipboard unavailable')
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(clipboardError)
    renderInvite()
    expect(await screen.findByText('AB23CD45')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }))

    expect((await screen.findByRole('alert')).textContent).toContain('复制失败，请手动选中内容复制')
  })

  it('在提交前拦截无效邀请码', async () => {
    const { apis } = renderInvite()
    expect(await screen.findByText('AB23CD45')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('补填邀请码'), { target: { value: 'I0O1' } })
    fireEvent.click(screen.getByRole('button', { name: '确认补填' }))

    expect((await screen.findByRole('alert')).textContent).toContain('请填写有效邀请码')
    expect(apis.redeemInviteCode).not.toHaveBeenCalled()
  })

  it('补填失败时保留邀请码，便于用户修正或重试', async () => {
    const apis = createApis()
    apis.redeemInviteCode.mockRejectedValue(new Error('邀请码已被使用'))
    renderInvite(apis)
    expect(await screen.findByText('AB23CD45')).toBeTruthy()

    const input = screen.getByLabelText('补填邀请码')
    fireEvent.change(input, { target: { value: 'MN67PQ89' } })
    fireEvent.click(screen.getByRole('button', { name: '确认补填' }))

    expect((await screen.findByRole('alert')).textContent).toContain('邀请码已被使用')
    expect((input as HTMLInputElement).value).toBe('MN67PQ89')
  })

  it('邀请信息加载失败后允许原地重试', async () => {
    const apis = createApis()
    apis.getInviteCode
      .mockRejectedValueOnce(new Error('邀请信息暂时不可用'))
      .mockResolvedValueOnce({
        code: 'AB23CD45',
        usedCount: 2,
        createdAt: '2026-08-12T01:02:03Z',
        updatedAt: '2026-08-17T01:02:03Z',
      })
    renderInvite(apis)

    expect((await screen.findByRole('alert')).textContent).toContain('邀请信息暂时不可用')
    fireEvent.click(screen.getByRole('button', { name: '重新加载邀请信息' }))

    expect(await screen.findByText('AB23CD45')).toBeTruthy()
  })
})
