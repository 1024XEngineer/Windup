// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { createBillApis } from '@/entities'
import { createBillBackend } from '@/test/bill-backend'
import { SubscriptionPage } from './index'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)

function setup(path = '/account/subscription', backend = createBillBackend()) {
  const navigateToPayment = vi.fn()
  const apis = createBillApis({ baseUrl: '/api', fetchFn: backend.fetchFn })
  render(
    <MemoryRouter initialEntries={[path]}>
      <SubscriptionPage apis={apis} navigateToPayment={navigateToPayment} />
    </MemoryRouter>,
  )
  return { backend, navigateToPayment }
}

it('展示后端商品价格和真实订阅，不把已有会员显示成 Free', async () => {
  const backend = createBillBackend()
  backend.products[0].amount_fen = 3100
  backend.subscription.active_subscription = {
    tier: 2,
    status: 1,
    period_start: '2026-10-01T00:00:00Z',
    period_end: '2026-11-01T00:00:00Z',
  }
  backend.subscription.expiring_credits = 1280
  setup(undefined, backend)
  expect(await screen.findByText('31')).toBeTruthy()
  expect(screen.getByLabelText('当前方案').textContent).toBe('Pro')
  expect(screen.getByLabelText('本期积分').textContent).toBe('1,280')
  expect(screen.getByLabelText('长期积分').textContent).toBe('250')
})

it('自定义金额先校验，再按整数分下单；重复点击不重复创建', async () => {
  const { backend, navigateToPayment } = setup('/account/subscription?tab=credits')
  await screen.findByLabelText('长期积分')
  const input = screen.getByLabelText('自定义充值金额')
  const buy = screen.getByRole('button', { name: '充值积分' }) as HTMLButtonElement
  for (const value of ['4', '5.5', '', 'abc']) {
    fireEvent.change(input, { target: { value } })
    expect(buy.disabled).toBe(true)
  }
  fireEvent.change(input, { target: { value: '7' } })
  expect(screen.getByLabelText('本次到账积分').textContent).toContain('88')
  fireEvent.click(buy)
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('radio', { name: '微信支付' }))
  const submit = within(dialog).getByRole('button', { name: '前往支付' })
  fireEvent.click(submit)
  fireEvent.click(submit)
  await waitFor(() => expect(navigateToPayment).toHaveBeenCalledTimes(1))
  expect(backend.calls.filter((call) => call.method === 'POST')).toEqual([
    expect.objectContaining({ path: '/bill/orders', body: { amount_fen: 700, channel: 'wxpay' } }),
  ])
  expect(navigateToPayment).toHaveBeenCalledWith(
    'https://cashier.example.test/submit.php?out_trade_no=ORD202610150001',
  )
})

it('订阅下单传商品编号，不由页面决定最终价格', async () => {
  const { backend, navigateToPayment } = setup()
  fireEvent.click(await screen.findByRole('button', { name: '选择 Pro' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '前往支付' }))
  await waitFor(() => expect(navigateToPayment).toHaveBeenCalledTimes(1))
  expect(backend.calls.find((call) => call.method === 'POST')?.body).toEqual({
    product_id: 12,
    channel: 'alipay',
  })
})

it('下单时价格变更必须重新确认，不能直接跳转付款', async () => {
  const { backend, navigateToPayment } = setup()
  fireEvent.click(await screen.findByRole('button', { name: '选择 Pro' }))
  backend.products[1].amount_fen = 10500
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '前往支付' }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByText('¥105')).toBeTruthy()
  expect(navigateToPayment).not.toHaveBeenCalled()
  expect(await within(dialog).findByText('价格或积分已更新，请核对订单后继续支付。')).toBeTruthy()
})

it('过期订单不能继续付款，界面等待后端确认终态', async () => {
  const backend = createBillBackend()
  backend.orders.push(backend.makeOrder({ expire_at: '2020-01-01T00:00:00Z' }))
  const { navigateToPayment } = setup('/account/subscription?order_no=ORD202610150001', backend)
  const dialog = await screen.findByRole('dialog')
  const button = (await within(dialog).findByRole('button', {
    name: '继续支付',
  })) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(within(dialog).queryByText('订单已关闭')).toBeNull()
  expect(navigateToPayment).not.toHaveBeenCalled()
})

it('回跳参数不能证明付款成功，订单确认支付后才刷新两类余额', async () => {
  const backend = createBillBackend()
  backend.orders.push(backend.makeOrder())
  setup('/account/subscription?out_trade_no=ORD202610150001&trade_status=TRADE_SUCCESS', backend)
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('button', { name: '继续支付' })
  expect(within(dialog).queryByText('支付成功')).toBeNull()
  expect(screen.getByLabelText('长期积分').textContent).toBe('250')
  backend.pay('ORD202610150001')
  fireEvent.click(within(dialog).getByRole('button', { name: '刷新支付结果' }))
  expect(await within(dialog).findByText('支付成功')).toBeTruthy()
  await waitFor(() => expect(screen.getByLabelText('长期积分').textContent).toBe('338'))
})

it('后端没有在售套餐时展示空态，不填充虚构套餐', async () => {
  const backend = createBillBackend()
  backend.products.splice(0)
  setup(undefined, backend)
  expect(await screen.findByText('暂无在售套餐')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '选择 Pro' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '积分充值' }))
  expect(screen.getByRole('button', { name: '充值积分' }).hasAttribute('disabled')).toBe(false)
})

it.each(['javascript:alert(1)', null])('无效支付地址不能跳转：%s', async (payUrl) => {
  const backend = createBillBackend()
  backend.orders.push(backend.makeOrder({ pay_url: payUrl }))
  const { navigateToPayment } = setup('/account/subscription?order_no=ORD202610150001', backend)
  const dialog = await screen.findByRole('dialog')
  const pay = (await within(dialog).findByRole('button', { name: '继续支付' })) as HTMLButtonElement
  expect(pay.disabled).toBe(true)
  expect(navigateToPayment).not.toHaveBeenCalled()
})

it('关闭待支付订单后采用服务端状态，不能继续付款', async () => {
  const backend = createBillBackend()
  backend.orders.push(backend.makeOrder())
  setup('/account/subscription?order_no=ORD202610150001', backend)
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(await within(dialog).findByRole('button', { name: '关闭订单' }))
  expect(await within(dialog).findByText('订单已关闭')).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: '继续支付' })).toBeNull()
})

it('下单失败可重试，不自动重复请求或伪装成功', async () => {
  const backend = createBillBackend()
  const fetchFn = backend.fetchFn
  backend.fetchFn = async (input, init) =>
    init?.method === 'POST'
      ? new Response(JSON.stringify({ code: 500, message: '支付网关暂不可用', data: null }))
      : fetchFn(input, init)
  const { navigateToPayment } = setup(undefined, backend)
  fireEvent.click(await screen.findByRole('button', { name: '选择 Plus' }))
  await act(async () =>
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '前往支付' })),
  )
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '支付网关暂不可用')
  expect(navigateToPayment).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: '前往支付' }) as HTMLButtonElement).disabled).toBe(
    false,
  )
})
