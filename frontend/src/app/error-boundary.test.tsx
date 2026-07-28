// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary, RouteErrorBoundary } from './error-boundary'

/**
 * 错误边界得真的兜得住才算数：这里让子组件抛异常，验证应用没有白屏、
 * 而是显示了兜底界面。React 会把错误往控制台打一遍，测试里静音掉。
 */
function Boom(): never {
  throw new Error('组件炸了')
}

describe('全局错误边界', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    // 没有这一行，上一个用例的 DOM 会留到下一个用例里，查询串味
    cleanup()
    vi.restoreAllMocks()
  })

  it('子组件抛异常时显示兜底界面，而不是整页空白', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('这个页面出错了')).toBeTruthy()
    expect(screen.getByText('组件炸了')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('没有异常时原样渲染子组件，不多加任何东西', () => {
    render(
      <ErrorBoundary>
        <p>一切正常</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('一切正常')).toBeTruthy()
    expect(screen.queryByText('这个页面出错了')).toBeNull()
  })

  it('路由位置变化后清除上一页的错误状态', () => {
    const view = render(
      <ErrorBoundary resetKey="/broken">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('这个页面出错了')).toBeTruthy()

    view.rerender(
      <ErrorBoundary resetKey="/healthy">
        <p>新页面正常</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('新页面正常')).toBeTruthy()
    expect(screen.queryByText('这个页面出错了')).toBeNull()
  })

  it('页面抛错后可以通过导航进入正常页面', async () => {
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <Link to="/healthy">离开错误页</Link>
        <RouteErrorBoundary>
          <Routes>
            <Route path="/broken" element={<Boom />} />
            <Route path="/healthy" element={<p>目标页面正常</p>} />
          </Routes>
        </RouteErrorBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByText('这个页面出错了')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '离开错误页' }))

    expect(await screen.findByText('目标页面正常')).toBeTruthy()
    expect(screen.queryByText('这个页面出错了')).toBeNull()
  })
})
