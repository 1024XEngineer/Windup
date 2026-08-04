// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('App Playtest route', () => {
  it('routes /playtest to the standalone workbench entry without the site navigation', () => {
    window.history.replaceState({}, '', '/playtest')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Playtest' })).toBeTruthy()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByText('项目')).toBeNull()
  })
})
