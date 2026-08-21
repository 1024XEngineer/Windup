// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Link, MemoryRouter, Route, Routes } from 'react-router'

import { RouteMotionSurface } from './route-motion'

function MotionFixture() {
  return (
    <>
      <Link to="/workspace">首页</Link>
      <Link to="/projects">项目资产</Link>
      <Link to="/projects?view=recent">项目筛选</Link>
      <Link to="/projects#recent">项目锚点</Link>
      <RouteMotionSurface>
        <Routes>
          <Route path="/workspace" element={<main>工作台</main>} />
          <Route path="/projects" element={<main>项目资产</main>} />
        </Routes>
      </RouteMotionSurface>
    </>
  )
}

afterEach(cleanup)

describe('RouteMotionSurface', () => {
  it('keeps header-order direction through StrictMode double renders', () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/workspace']}>
          <MotionFixture />
        </MemoryRouter>
      </StrictMode>,
    )

    fireEvent.click(screen.getByRole('link', { name: '项目资产' }))
    expect(screen.getByTestId('route-motion-surface').dataset.motionDirection).toBe('forward')

    fireEvent.click(screen.getByRole('link', { name: '首页' }))
    expect(screen.getByTestId('route-motion-surface').dataset.motionDirection).toBe('backward')
  })

  it.each(['项目筛选', '项目锚点'])('does not reactivate motion for %s navigation', (link) => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/workspace']}>
          <MotionFixture />
        </MemoryRouter>
      </StrictMode>,
    )

    fireEvent.click(screen.getByRole('link', { name: '项目资产' }))
    expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('true')

    fireEvent.click(screen.getByRole('link', { name: link }))
    expect(screen.getByTestId('route-motion-surface').dataset.motionActive).toBe('false')
  })
})
