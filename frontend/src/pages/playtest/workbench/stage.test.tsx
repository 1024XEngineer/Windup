// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PlaytestStage } from './stage'

afterEach(cleanup)

function renderStage(x: number) {
  render(
    <PlaytestStage
      frame={{ imageUrl: '/idle-01.png', durationMs: 100 }}
      x={x}
      facing={1}
      onBoundsChange={() => undefined}
    />,
  )
  return screen.getByRole('region', { name: '预览舞台' }).querySelector('img')
}

describe('PlaytestStage', () => {
  it('centers and moves the sprite through a single transform', () => {
    const sprite = renderStage(40)

    expect(sprite?.style.transform).toBe('translate3d(calc(-50% + 40px), 0, 0) scaleX(1)')
    expect(sprite?.getAttribute('loading')).toBe('eager')
    expect(sprite?.getAttribute('decoding')).toBe('async')
    expect(sprite?.getAttribute('fetchpriority')).toBe('high')
    // jsdom 不排版，量不出偏移，只能守住成因：Tailwind v4 的 translate 工具类走独立的
    // translate 属性，与 transform 叠加而非覆盖，两处都写会让静止位置左偏半个精灵宽。
    expect(sprite?.className).not.toMatch(/(^|\s)-?translate-/)
  })

  it('shows an empty stage when the action has no frame to play', () => {
    render(<PlaytestStage frame={null} x={0} facing={1} onBoundsChange={() => undefined} />)

    expect(screen.getByText('暂无可播放帧')).toBeTruthy()
  })
})
