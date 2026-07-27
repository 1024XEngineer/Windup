// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './error-boundary'

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
})
