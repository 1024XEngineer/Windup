// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { App } from './index'

describe('AssetLibraryPage', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/projects/project-1/assets')
  })

  afterEach(() => {
    cleanup()
  })

  it('从项目路径读取资产库所属项目', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '资产库' })).toBeTruthy()
    expect(screen.getByText('项目 project-1 内可复用的角色、动作与穿戴')).toBeTruthy()
  })
})
