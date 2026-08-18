// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Pagination } from './pagination'

afterEach(cleanup)

describe('Pagination', () => {
  it('在数字模式下显示稳定页码并保留首尾页', () => {
    const onPageChange = vi.fn()
    render(
      <Pagination page={5} pageSize={10} total={100} showPageNumbers onPageChange={onPageChange} />,
    )

    expect(screen.getByRole('button', { name: '第 1 页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '第 5 页' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByRole('button', { name: '第 10 页' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '第 6 页' }))
    expect(onPageChange).toHaveBeenCalledWith(6)
  })
})
