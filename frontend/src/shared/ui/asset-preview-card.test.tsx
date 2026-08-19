// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AssetPreviewCard } from './asset-preview-card'

afterEach(cleanup)

describe('AssetPreviewCard', () => {
  it('renders the shared empty preview treatment and target link', () => {
    render(
      <MemoryRouter>
        <AssetPreviewCard
          to="/playtest/51/outfit-1"
          ariaLabel="继续预览 轻装信使 · 常态"
          title="轻装信使"
          subtitle="常态"
          trailing="点灯人 · MVP"
          previewUrl={null}
          previewAlt="轻装信使 · 常态预览图"
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('link', { name: '继续预览 轻装信使 · 常态' }).getAttribute('href'),
    ).toBe('/playtest/51/outfit-1')
    expect(screen.getByText('暂无造型预览')).toBeTruthy()
  })

  it('uses eager loading only for the prioritized real preview', () => {
    render(
      <MemoryRouter>
        <AssetPreviewCard
          to="/projects/42/assets/51"
          ariaLabel="查看角色 轻装信使"
          title="轻装信使"
          subtitle="常态"
          trailing="↗"
          previewUrl="https://cdn.windup.test/outfit-1.png"
          previewAlt="轻装信使的常态预览"
          priority
        />
      </MemoryRouter>,
    )

    const image = screen.getByRole('img', { name: '轻装信使的常态预览' })
    expect(image.getAttribute('loading')).toBe('eager')
    expect(image.getAttribute('fetchpriority')).toBe('high')
  })

  it('can eager-load a visible preview without giving it high network priority', () => {
    render(
      <MemoryRouter>
        <AssetPreviewCard
          to="/projects/42/assets/52"
          ariaLabel="查看角色 第二个角色"
          title="第二个角色"
          subtitle="常态"
          trailing="↗"
          previewUrl="https://cdn.windup.test/outfit-2.png"
          previewAlt="第二个角色的常态预览"
          eager
        />
      </MemoryRouter>,
    )

    const image = screen.getByRole('img', { name: '第二个角色的常态预览' })
    expect(image.getAttribute('loading')).toBe('eager')
    expect(image.getAttribute('fetchpriority')).toBe('auto')
  })
})
