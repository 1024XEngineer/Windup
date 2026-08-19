// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlaytestActionBindings } from '../bindings'
import type { PlaytestAction } from '../model'
import { preloadActionFrames, usePlaytestRuntime } from './use-playtest-runtime'

afterEach(() => {
  vi.unstubAllGlobals()
})

const actions: readonly PlaytestAction[] = [
  {
    id: 'idle',
    name: '待机',
    type: 'idle',
    loop: true,
    frames: [
      { imageUrl: '/idle-1.png', durationMs: 100 },
      { imageUrl: '/idle-2.png', durationMs: 100 },
    ],
  },
  {
    id: 'walk',
    name: '行走',
    type: 'walk',
    loop: true,
    frames: [
      { imageUrl: '/walk-1.png', durationMs: 100 },
      { imageUrl: '/idle-1.png', durationMs: 100 },
    ],
  },
  {
    id: 'attack',
    name: '攻击',
    type: 'attack',
    loop: false,
    frames: [{ imageUrl: '/attack-1.png', durationMs: 100 }],
  },
]

const bindings: PlaytestActionBindings = {
  space: 'attack',
  shift: null,
}

const directionalActions: readonly PlaytestAction[] = actions.map((action) =>
  action.id === 'walk'
    ? {
        ...action,
        sequences: {
          east: { frames: action.frames, sourceDirection: 'east', mirrorX: false },
          west: { frames: action.frames, sourceDirection: 'east', mirrorX: true },
          north: {
            frames: [{ imageUrl: '/walk-north.png', durationMs: 100 }],
            sourceDirection: 'north',
            mirrorX: false,
          },
          south: {
            frames: [{ imageUrl: '/walk-south.png', durationMs: 100 }],
            sourceDirection: 'south',
            mirrorX: false,
          },
        },
      }
    : action,
)

describe('preloadActionFrames', () => {
  it('prioritizes the active action while preloading every unique bound frame', () => {
    const loaded: string[] = []
    const decoded: string[] = []
    const priorities: string[] = []
    const createImage = () => {
      let currentUrl = ''
      let currentPriority = 'auto'
      return {
        get src() {
          return currentUrl
        },
        set src(url: string) {
          currentUrl = url
          loaded.push(url)
          priorities.push(currentPriority)
        },
        get fetchPriority() {
          return currentPriority
        },
        set fetchPriority(priority: string) {
          currentPriority = priority
        },
        decode: vi.fn(() => {
          decoded.push(currentUrl)
          return Promise.resolve()
        }),
      } as unknown as HTMLImageElement
    }

    preloadActionFrames(actions, 'walk', createImage)

    expect(loaded).toEqual(['/walk-1.png', '/idle-1.png', '/idle-2.png', '/attack-1.png'])
    expect(priorities).toEqual(['high', 'high', 'low', 'low'])
    expect(decoded).toEqual(loaded)
  })

  it('preloads independent north and south direction frames', () => {
    const loaded: string[] = []
    const createImage = () =>
      ({
        set src(url: string) {
          loaded.push(url)
        },
      }) as HTMLImageElement

    preloadActionFrames(directionalActions, 'walk', createImage)

    expect(loaded).toContain('/walk-north.png')
    expect(loaded).toContain('/walk-south.png')
  })

  it('skips an empty optional directional playback while collecting frame URLs', () => {
    const empty: PlaytestAction = {
      id: 'empty',
      name: '空动作',
      type: 'idle',
      loop: true,
      frames: [],
      sequences: { north: undefined },
    }

    expect(preloadActionFrames([empty], null, () => ({}) as HTMLImageElement)).toEqual([])
  })

  it('does not restart the preload batch when the user switches actions', () => {
    const createImage = vi.fn(() => ({
      decode: vi.fn(() => Promise.resolve()),
    }))
    vi.stubGlobal('Image', function Image() {
      return createImage()
    })
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { result } = renderHook(() => usePlaytestRuntime(actions, 'idle'))
    expect(createImage).toHaveBeenCalledTimes(4)

    act(() => result.current.selectAction('walk'))

    expect(createImage).toHaveBeenCalledTimes(4)
  })

  it('routes Space and Shift through assignments while movement keys stay fixed', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const keyboardBindings = { ...bindings, shift: 'attack' }
    const { result } = renderHook(() =>
      usePlaytestRuntime(actions, 'idle', 'single', keyboardBindings),
    )

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' })))
    expect(result.current.action?.id).toBe('attack')
    act(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space' })))

    act(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft' })),
    )
    expect(result.current.action?.id).toBe('attack')

    act(() => result.current.selectAction('idle'))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' })))
    expect(result.current.action?.id).toBe('idle')

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' })))
    expect(result.current.runtime).toMatchObject({ actionId: 'walk', facing: 'west' })
    act(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA' })))
    expect(result.current.runtime).toMatchObject({ actionId: 'idle', held: { left: false } })

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD' })))
    expect(result.current.runtime).toMatchObject({ actionId: 'walk', held: { right: true } })
    act(() => window.dispatchEvent(new Event('blur')))
    expect(result.current.runtime).toMatchObject({
      actionId: 'idle',
      held: { left: false, right: false },
    })
  })

  it('routes W and S to depth movement when directional assets exist', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const { result } = renderHook(() =>
      usePlaytestRuntime(directionalActions, 'idle', 'four-way', bindings),
    )

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' })))
    expect(result.current.runtime).toMatchObject({ actionId: 'walk', facing: 'north' })
    act(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW' })))

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS' })))
    expect(result.current.runtime).toMatchObject({ actionId: 'walk', facing: 'south' })
  })

  it('ignores typing and unknown keys while keeping the direction compatibility entry', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const { result } = renderHook(() => usePlaytestRuntime(actions, 'idle'))
    const input = document.createElement('input')
    document.body.append(input)

    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })))
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    act(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' })))
    expect(result.current.runtime.actionId).toBe('idle')

    act(() => result.current.setDirection('left', true, 'legacy:left'))
    expect(result.current.runtime).toMatchObject({ actionId: 'walk', facing: 'west' })
    act(() => result.current.setDirection('left', false, 'legacy:left'))
    expect(result.current.runtime.actionId).toBe('idle')
    act(() => result.current.setBounds({ minX: -1, maxX: 1 }))
    expect(result.current.runtime.y).toBe(0)
    input.remove()
  })

  it('advances the animation clock and clamps position when bounds change', () => {
    let tick: FrameRequestCallback | undefined
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        tick = callback
        return 1
      }),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const { result } = renderHook(() =>
      usePlaytestRuntime(directionalActions, 'walk', 'four-way', bindings),
    )

    act(() => result.current.setBounds({ minX: -20, maxX: 20, minY: -30, maxY: 30 }))
    act(() => result.current.setMovement('right', true))
    act(() => tick?.(0))
    act(() => tick?.(50))
    expect(result.current.runtime.x).toBeGreaterThan(0)

    act(() => result.current.setBounds({ minX: -2, maxX: 2, minY: -3, maxY: 3 }))
    expect(result.current.runtime).toMatchObject({ x: 2, y: 0 })
  })
})
