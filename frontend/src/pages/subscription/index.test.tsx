// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { SubscriptionPage } from './index'

afterEach(cleanup)

it('rounds custom credits up and rejects fractional or insufficient payments', () => {
  render(
    <MemoryRouter initialEntries={['/account/subscription?tab=credits']}>
      <SubscriptionPage />
    </MemoryRouter>,
  )
  const input = screen.getByLabelText('自定义充值金额')
  fireEvent.change(input, { target: { value: '7' } })
  expect(screen.getByText('88')).toBeTruthy()
  const buy = screen.getByRole('button', { name: '充值积分' }) as HTMLButtonElement
  expect(buy.disabled).toBe(false)
  for (const value of ['4', '5.5', '', 'abc']) {
    fireEvent.change(input, { target: { value } })
    expect(buy.disabled).toBe(true)
    expect(screen.getByRole('alert')).toBeTruthy()
  }
})

it('highlights a selected plan and explains that payment is not connected', () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  render(
    <MemoryRouter>
      <SubscriptionPage />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByText('Pro'))
  expect(screen.getByText('Pro').closest('article')?.className).toContain('selected')

  fireEvent.click(screen.getByRole('button', { name: '已选择' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog.textContent).toContain('¥99')
  expect(dialog.textContent).toContain('1,500 积分')
  expect(dialog.textContent).toContain('支付还没有接入，请联系管理员')
  expect(dialog.textContent).toContain('不会扣款')
  expect(screen.getByText('当前订阅方案：')).toBeTruthy()
})
