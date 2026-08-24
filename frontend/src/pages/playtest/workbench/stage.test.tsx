// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlaytestStage } from './stage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderStage(x: number, y = 0, mirrorX = false) {
  render(
    <PlaytestStage
      frame={{ imageUrl: '/idle-01.png', durationMs: 100 }}
      x={x}
      y={y}
      mirrorX={mirrorX}
      onBoundsChange={() => undefined}
    />,
  )
  return screen.getByRole('region', { name: '预览舞台' }).querySelector('img')
}

describe('PlaytestStage', () => {
  it('centers and moves the sprite through a single transform', () => {
    const sprite = renderStage(40, -25)

    expect(sprite?.style.transform).toBe('translate3d(calc(-50% + 40px), -25px, 0) scaleX(1)')
    expect(sprite?.getAttribute('loading')).toBe('eager')
    expect(sprite?.getAttribute('decoding')).toBe('async')
    expect(sprite?.getAttribute('fetchpriority')).toBe('high')
    // jsdom 不排版，量不出偏移，只能守住成因：Tailwind v4 的 translate 工具类走独立的
    // translate 属性，与 transform 叠加而非覆盖，两处都写会让静止位置左偏半个精灵宽。
    expect(sprite?.className).not.toMatch(/(^|\s)-?translate-/)
  })

  it('mirrors only playback that explicitly requests horizontal reflection', () => {
    expect(renderStage(0, 0, true)?.style.transform).toContain('scaleX(-1)')
    cleanup()
    expect(renderStage(0, 0, false)?.style.transform).toContain('scaleX(1)')
  })

  it('shows an empty stage when the action has no frame to play', () => {
    render(
      <PlaytestStage frame={null} x={0} y={0} mirrorX={false} onBoundsChange={() => undefined} />,
    )

    expect(screen.getByText('暂无可播放帧')).toBeTruthy()
  })

  it('reports a failed frame and retries the same image on demand', () => {
    const firstSprite = renderStage(0)!

    fireEvent.error(firstSprite)

    expect(screen.getByText('当前帧加载失败')).toBeTruthy()
    const retry = screen.getByRole('button', { name: '重试当前帧' })
    fireEvent.click(retry)

    expect(screen.queryByText('当前帧加载失败')).toBeNull()
    const retriedSprite = screen.getByRole('region', { name: '预览舞台' }).querySelector('img')
    expect(retriedSprite).not.toBe(firstSprite)
    expect(retriedSprite?.getAttribute('src')).toBe('/idle-01.png')
  })

  it('clears a frame failure when playback advances to another image', () => {
    const { rerender } = render(
      <PlaytestStage
        frame={{ imageUrl: '/idle-01.png', durationMs: 100 }}
        x={0}
        y={0}
        mirrorX={false}
        onBoundsChange={() => undefined}
      />,
    )
    const stage = screen.getByRole('region', { name: '预览舞台' })
    fireEvent.error(stage.querySelector('img')!)

    rerender(
      <PlaytestStage
        frame={{ imageUrl: '/walk-02.png', durationMs: 100 }}
        x={0}
        y={0}
        mirrorX={false}
        onBoundsChange={() => undefined}
      />,
    )

    expect(screen.queryByText('当前帧加载失败')).toBeNull()
    expect(stage.querySelector('img')?.getAttribute('src')).toBe('/walk-02.png')
  })

  it('measures horizontal and depth bounds from the stage and sprite sizes', () => {
    const onBoundsChange = vi.fn()
    render(
      <PlaytestStage
        frame={{ imageUrl: '/idle-01.png', durationMs: 100 }}
        x={0}
        y={0}
        mirrorX={false}
        onBoundsChange={onBoundsChange}
      />,
    )
    const stage = screen.getByRole('region', { name: '预览舞台' })
    const sprite = stage.querySelector('img')!
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      width: 500,
      height: 400,
    } as DOMRect)
    vi.spyOn(sprite, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 120,
    } as DOMRect)

    fireEvent.load(sprite)

    expect(onBoundsChange).toHaveBeenLastCalledWith({
      minX: -172,
      maxX: 172,
      minY: -96,
      maxY: 96,
    })
  })

  it('observes stage resizes and disconnects the observer on unmount', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe = observe
        disconnect = disconnect
      },
    )

    const { unmount } = render(
      <PlaytestStage
        frame={{ imageUrl: '/idle-01.png', durationMs: 100 }}
        x={0}
        y={0}
        mirrorX={false}
        onBoundsChange={() => undefined}
      />,
    )
    const stage = screen.getByRole('region', { name: '预览舞台' })

    expect(observe).toHaveBeenCalledWith(stage)
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
