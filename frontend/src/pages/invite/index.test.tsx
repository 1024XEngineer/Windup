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
      expiresAt: '2026-09-16T03:00:00Z',
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })),
    generateInviteCode: vi.fn(async () => ({
      code: 'XY89KL23',
      usedCount: 2,
      expiresAt: '2026-09-16T03:00:00Z',
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T03:00:00Z',
    })),
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

  it('展示最终奖励规则、当前邀请码使用次数和有效期', async () => {
    renderInvite()

    expect(await screen.findByText('AB23CD45')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('100')).toBeTruthy()
    expect(screen.getByText('当前码注册')).toBeTruthy()
    expect(screen.getByText(/好友注册共得 500 积分/)).toBeTruthy()
    expect(screen.getByText(/每日前 3 位各得 200 积分/)).toBeTruthy()
    expect(screen.getByText('有效至 2026年9月16日')).toBeTruthy()
  })

  it('邀请码有效期异常时使用安全提示', async () => {
    const apis = createApis()
    apis.getInviteCode.mockResolvedValue({
      code: 'AB23CD45',
      usedCount: 2,
      expiresAt: 'not-a-date',
      createdAt: '2026-08-12T01:02:03Z',
      updatedAt: '2026-08-17T01:02:03Z',
    })

    renderInvite(apis)

    expect(await screen.findByText('有效期未知')).toBeTruthy()
  })

  it('复制邀请码与注册链接', async () => {
    renderInvite()

    expect(await screen.findByText('AB23CD45')).toBeTruthy()

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

  it('不提供登录后的补填邀请码入口', async () => {
    renderInvite()
    expect(await screen.findByText('AB23CD45')).toBeTruthy()

    expect(screen.queryByLabelText('补填邀请码')).toBeNull()
    expect(screen.queryByRole('button', { name: '确认补填' })).toBeNull()
  })

  it('复制失败时给出可恢复提示', async () => {
    const clipboardError = new Error('clipboard unavailable')
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(clipboardError)
    renderInvite()
    expect(await screen.findByText('AB23CD45')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }))

    expect((await screen.findByRole('alert')).textContent).toContain('复制失败，请重试')
  })

  it('复制失败时优先展示当前操作错误', async () => {
    const apis = createApis()
    apis.getBalance.mockRejectedValue(new Error('积分账户不可用'))
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('clipboard unavailable'))
    renderInvite(apis)
    expect(await screen.findByText('AB23CD45')).toBeTruthy()
    expect(await screen.findByText('积分账户不可用')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('复制失败，请重试'))
    expect(screen.queryByText('积分账户不可用')).toBeNull()
  })

  it('非标准接口错误使用通用提示', async () => {
    const apis = createApis()
    apis.getInviteCode.mockRejectedValue('invite unavailable')
    renderInvite(apis)

    expect((await screen.findByRole('alert')).textContent).toContain('操作失败，请稍后重试')
  })

  it('邀请信息加载失败后允许原地重试', async () => {
    const apis = createApis()
    apis.getInviteCode
      .mockRejectedValueOnce(new Error('邀请信息暂时不可用'))
      .mockResolvedValueOnce({
        code: 'AB23CD45',
        usedCount: 2,
        expiresAt: '2026-09-16T03:00:00Z',
        createdAt: '2026-08-12T01:02:03Z',
        updatedAt: '2026-08-17T01:02:03Z',
      })
    renderInvite(apis)

    expect((await screen.findByRole('alert')).textContent).toContain('邀请信息暂时不可用')
    fireEvent.click(screen.getByRole('button', { name: '重新加载邀请信息' }))

    expect(await screen.findByText('AB23CD45')).toBeTruthy()
  })
})
