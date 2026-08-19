// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AssetPreviewCard, AssetThumbnailImage } from './asset-preview-card'

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

  it('keeps source assets unchanged unless a list explicitly opts into thumbnails', () => {
    render(
      <MemoryRouter>
        <AssetPreviewCard
          to="/playtest/51/outfit-1"
          ariaLabel="继续预览 轻装信使"
          title="轻装信使"
          subtitle="常态"
          trailing="最近"
          previewUrl="https://cdn.windup.test/media/outfit-preview/outfit-1.source.png"
          previewAlt="轻装信使原图"
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('img', { name: '轻装信使原图' }).getAttribute('src')).toBe(
      'https://cdn.windup.test/media/outfit-preview/outfit-1.source.png',
    )
  })

  it('loads the card thumbnail first and falls back to the original asset', () => {
    render(
      <MemoryRouter>
        <AssetPreviewCard
          to="/projects/42/assets/51"
          ariaLabel="查看角色 轻装信使"
          title="轻装信使"
          subtitle="常态"
          trailing="↗"
          previewUrl="https://cdn.windup.test/media/outfit-preview/outfit-1.source.png"
          previewAlt="轻装信使的常态预览"
          thumbnail
        />
      </MemoryRouter>,
    )

    const image = screen.getByRole('img', { name: '轻装信使的常态预览' })
    expect(image.getAttribute('src')).toBe(
      'https://cdn.windup.test/media/outfit-preview/outfit-1.card.webp',
    )

    fireEvent.error(image)

    expect(image.getAttribute('src')).toBe(
      'https://cdn.windup.test/media/outfit-preview/outfit-1.source.png',
    )
  })

  it('derives the thumbnail from a source key that carries no file extension', () => {
    render(
      <MemoryRouter>
        <AssetPreviewCard
          to="/projects/42/assets/53"
          ariaLabel="查看角色 无扩展名"
          title="无扩展名"
          subtitle="常态"
          trailing="↗"
          previewUrl="https://cdn.windup.test/media/reference-image/outfit-1.source"
          previewAlt="无扩展名的常态预览"
          thumbnail
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('img', { name: '无扩展名的常态预览' }).getAttribute('src')).toBe(
      'https://cdn.windup.test/media/reference-image/outfit-1.card.webp',
    )
  })

  // 缩略图是兄弟 key 推导出来的,推导不成立时必须原样用原图,不能猜一个不存在的地址出来。
  it.each([
    ['a malformed URL', 'not-a-url'],
    ['a query string', 'https://cdn.windup.test/media/outfit-preview/outfit-1.source.png?v=2'],
    ['a fragment', 'https://cdn.windup.test/media/outfit-preview/outfit-1.source.png#top'],
    ['no source suffix', 'https://cdn.windup.test/media/outfit-preview/outfit-1.png'],
    ['no file name suffix at all', 'https://cdn.windup.test/media/outfit-preview/outfit-1'],
  ])('keeps the original asset when the preview URL has %s', (_case, previewUrl) => {
    render(
      <MemoryRouter>
        <AssetPreviewCard
          to="/projects/42/assets/54"
          ariaLabel="查看角色 无法推导"
          title="无法推导"
          subtitle="常态"
          trailing="↗"
          previewUrl={previewUrl}
          previewAlt="无法推导的常态预览"
          thumbnail
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('img', { name: '无法推导的常态预览' }).getAttribute('src')).toBe(
      previewUrl,
    )
  })
})

describe('AssetThumbnailImage', () => {
  const sourceUrl = 'https://cdn.windup.test/media/outfit-preview/outfit-1.source.png'
  const thumbnailUrl = 'https://cdn.windup.test/media/outfit-preview/outfit-1.card.webp'

  it('forwards every image error to the caller, including the one that triggers the fallback', () => {
    const onError = vi.fn()
    render(<AssetThumbnailImage src={sourceUrl} alt="造型缩略图" onError={onError} />)

    const image = screen.getByRole('img', { name: '造型缩略图' })
    expect(image.getAttribute('src')).toBe(thumbnailUrl)

    fireEvent.error(image)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(image.getAttribute('src')).toBe(sourceUrl)

    fireEvent.error(image)
    expect(onError).toHaveBeenCalledTimes(2)
    expect(image.getAttribute('src')).toBe(sourceUrl)
  })

  it('tries the thumbnail again once the asset itself changes', () => {
    const { rerender } = render(<AssetThumbnailImage src={sourceUrl} alt="造型缩略图" />)

    fireEvent.error(screen.getByRole('img', { name: '造型缩略图' }))
    expect(screen.getByRole('img', { name: '造型缩略图' }).getAttribute('src')).toBe(sourceUrl)

    const nextSource = 'https://cdn.windup.test/media/outfit-preview/outfit-2.source.png'
    rerender(<AssetThumbnailImage src={nextSource} alt="造型缩略图" />)

    expect(screen.getByRole('img', { name: '造型缩略图' }).getAttribute('src')).toBe(
      'https://cdn.windup.test/media/outfit-preview/outfit-2.card.webp',
    )
  })
})
