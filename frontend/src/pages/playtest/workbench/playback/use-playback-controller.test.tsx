/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PreviewAction } from '../model/types'
import { type PlaybackController, usePlaybackController } from './use-playback-controller'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const actions: readonly PreviewAction[] = [
  {
    id: 'walk',
    name: 'Walk',
    type: 'walk',
    fps: 12,
    sequences: [
      {
        direction: 'south',
        frames: [
          {
            imageUrl: '/walk-0.png',
            durationMs: 80,
            rootMotion: null,
            keyFrame: true,
          },
          {
            imageUrl: '/walk-1.png',
            durationMs: 160,
            rootMotion: null,
            keyFrame: false,
          },
          {
            imageUrl: '/walk-2.png',
            durationMs: 120,
            rootMotion: null,
            keyFrame: false,
          },
        ],
      },
    ],
  },
  {
    id: 'idle',
    name: 'Idle',
    type: 'idle',
    fps: 10,
    sequences: [
      {
        direction: 'default',
        frames: [
          {
            imageUrl: '/idle-0.png',
            durationMs: 100,
            rootMotion: null,
            keyFrame: true,
          },
        ],
      },
    ],
  },
  {
    id: 'jump',
    name: 'Jump',
    type: 'jump',
    fps: 10,
    sequences: [
      {
        direction: 'default',
        frames: [
          {
            imageUrl: '/jump-0.png',
            durationMs: 100,
            rootMotion: { dx: 0, dy: 12 },
            keyFrame: true,
          },
        ],
      },
    ],
  },
]

interface MountedController {
  readonly controller: PlaybackController
  unmount(): void
}

function mountController(initialActionId = 'walk'): MountedController {
  const host = document.createElement('div')
  const root: Root = createRoot(host)
  let controller: PlaybackController | null = null

  function Probe() {
    controller = usePlaybackController(actions, initialActionId)
    return null
  }

  act(() => {
    root.render(<Probe />)
  })

  return {
    get controller() {
      if (controller === null) throw new Error('controller was not rendered')
      return controller
    },
    unmount() {
      act(() => {
        root.unmount()
      })
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('usePlaybackController', () => {
  it('plays the first playable action of a requested type without changing loop mode', () => {
    // Catches typed shortcuts preserving stale position, pausing the target, or changing loop mode.
    const mounted = mountController()

    act(() => {
      mounted.controller.toggleLoop()
      mounted.controller.selectFrame(2)
      mounted.controller.playActionType('jump')
    })

    expect(mounted.controller.state).toMatchObject({
      actionId: 'jump',
      direction: 'default',
      frameIndex: 0,
      playing: true,
      loop: false,
    })

    const current = mounted.controller.state
    act(() => {
      mounted.controller.playActionType('attack')
    })
    expect(mounted.controller.state).toBe(current)
    mounted.unmount()
  })

  it('exposes walk continuation that resumes the current walk without resetting playback position', () => {
    // Catches keyboard direction controls being forced through the restart-only action command.
    const mounted = mountController()

    act(() => {
      mounted.controller.selectFrame(2)
      mounted.controller.toggleLoop()
    })

    const controller = mounted.controller as PlaybackController & {
      continueActionType?: (type: 'walk') => void
    }
    expect(controller.continueActionType).toBeTypeOf('function')
    act(() => {
      controller.continueActionType?.('walk')
    })

    expect(mounted.controller.state).toMatchObject({
      actionId: 'walk',
      direction: 'south',
      frameIndex: 2,
      playing: true,
      loop: false,
    })
    mounted.unmount()
  })

  it('increments frameTick for every timed advance, including a single-frame loop', () => {
    // Catches stage motion missing a loop iteration because its visible frame index remains zero.
    vi.useFakeTimers()
    const mounted = mountController()
    const controller = mounted.controller as PlaybackController & { frameTick?: number }

    expect(controller.frameTick).toBe(0)
    act(() => {
      mounted.controller.selectAction('idle')
      mounted.controller.togglePlaying()
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(mounted.controller.state).toMatchObject({
      actionId: 'idle',
      frameIndex: 0,
      playing: true,
    })
    expect((mounted.controller as PlaybackController & { frameTick?: number }).frameTick).toBe(1)
    mounted.unmount()
  })

  it('waits for each current-frame duration before advancing', () => {
    // Catches fixed-interval scheduling that skips the current frame's actual duration.
    vi.useFakeTimers()
    const mounted = mountController()

    act(() => {
      mounted.controller.togglePlaying()
    })
    act(() => {
      vi.advanceTimersByTime(79)
    })
    expect(mounted.controller.state.frameIndex).toBe(0)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(mounted.controller.state.frameIndex).toBe(1)

    act(() => {
      vi.advanceTimersByTime(159)
    })
    expect(mounted.controller.state.frameIndex).toBe(1)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(mounted.controller.state.frameIndex).toBe(2)
    mounted.unmount()
  })

  it('clears playback when paused or when its action changes', () => {
    // Catches old timers advancing a manually paused or newly selected action.
    vi.useFakeTimers()
    const mounted = mountController()

    act(() => {
      mounted.controller.togglePlaying()
      mounted.controller.togglePlaying()
      vi.advanceTimersByTime(500)
    })
    expect(mounted.controller.state).toMatchObject({
      actionId: 'walk',
      frameIndex: 0,
      playing: false,
    })

    act(() => {
      mounted.controller.togglePlaying()
      mounted.controller.selectAction('idle')
      vi.advanceTimersByTime(500)
    })
    expect(mounted.controller.state).toMatchObject({
      actionId: 'idle',
      frameIndex: 0,
      playing: false,
    })
    mounted.unmount()
  })

  it('restarts the current-frame timeout when loop changes', () => {
    // Catches a pending timeout surviving a loop-mode change near the frame boundary.
    vi.useFakeTimers()
    const mounted = mountController()

    act(() => {
      mounted.controller.togglePlaying()
    })
    act(() => {
      vi.advanceTimersByTime(80)
    })
    act(() => {
      vi.advanceTimersByTime(159)
    })
    expect(mounted.controller.state.frameIndex).toBe(1)

    act(() => {
      mounted.controller.toggleLoop()
    })
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(mounted.controller.state.frameIndex).toBe(1)

    act(() => {
      vi.advanceTimersByTime(159)
    })
    expect(mounted.controller.state.frameIndex).toBe(2)
    mounted.unmount()
  })

  it('cleans up a scheduled timeout when unmounted', () => {
    // Catches a timeout retaining the controller after its React tree is gone.
    vi.useFakeTimers()
    const mounted = mountController()

    act(() => {
      mounted.controller.togglePlaying()
    })
    expect(vi.getTimerCount()).toBe(1)

    mounted.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
