/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type PlaytestKeyboardCommands, usePlaytestKeyboard } from './use-playtest-keyboard'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mountedRoots = new Set<Root>()

function createCommands(): PlaytestKeyboardCommands {
  return {
    togglePlaying: vi.fn(),
    previousFrame: vi.fn(),
    nextFrame: vi.fn(),
    firstFrame: vi.fn(),
    lastFrame: vi.fn(),
    toggleLoop: vi.fn(),
    playLeft: vi.fn(),
    playRight: vi.fn(),
    stopHorizontal: vi.fn(),
    playJump: vi.fn(),
    playCrouch: vi.fn(),
  }
}

const shortcutKeys = [' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'L'] as const
const interactiveShortcutKeys = [...shortcutKeys, 'a', 'D', 'w', 'S'] as const

function dispatchKey(
  key: string,
  target: EventTarget = window,
  options: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...options,
  })
  target.dispatchEvent(event)
  return event
}

function mountKeyboard(commands: PlaytestKeyboardCommands, enabled = true): () => void {
  const host = document.createElement('div')
  const root: Root = createRoot(host)

  function Probe() {
    usePlaytestKeyboard(commands, enabled)
    return null
  }

  act(() => {
    root.render(<Probe />)
  })
  mountedRoots.add(root)

  return () => {
    if (!mountedRoots.delete(root)) return

    act(() => {
      root.unmount()
    })
  }
}

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => {
      root.unmount()
    })
  }
  mountedRoots.clear()
  document.body.replaceChildren()
})

describe('usePlaytestKeyboard', () => {
  it('maps the playback shortcuts to their commands', () => {
    // Catches an incomplete or swapped shortcut map while the workbench is focused.
    const commands = createCommands()
    const unmount = mountKeyboard(commands)

    const events = shortcutKeys.map((key) => dispatchKey(key))

    expect(events.every((event) => event.defaultPrevented)).toBe(true)

    expect(commands.togglePlaying).toHaveBeenCalledOnce()
    expect(commands.previousFrame).toHaveBeenCalledOnce()
    expect(commands.nextFrame).toHaveBeenCalledOnce()
    expect(commands.firstFrame).toHaveBeenCalledOnce()
    expect(commands.lastFrame).toHaveBeenCalledOnce()
    expect(commands.toggleLoop).toHaveBeenCalledOnce()
    unmount()
  })

  it('maps A/D to directional walk commands and W/S to action commands', () => {
    // Catches A/D retaining their old frame-navigation semantics instead of selecting a walk direction.
    const commands = createCommands()
    const unmount = mountKeyboard(commands)

    dispatchKey('a')
    dispatchKey('D')
    dispatchKey('w')
    dispatchKey('S')

    expect(commands.playLeft).toHaveBeenCalledOnce()
    expect(commands.playRight).toHaveBeenCalledOnce()
    expect(commands.playJump).toHaveBeenCalledOnce()
    expect(commands.playCrouch).toHaveBeenCalledOnce()
    unmount()
  })

  it('handles shortcuts dispatched from the body and ordinary elements', () => {
    // Catches a missing editable ancestor being mistaken for an interactive editing surface.
    const commands = createCommands()
    const target = document.createElement('div')
    document.body.append(target)
    const unmount = mountKeyboard(commands)

    const arrowEvent = dispatchKey('ArrowRight', document.body)
    const spaceEvent = dispatchKey(' ', target)

    expect(arrowEvent.defaultPrevented).toBe(true)
    expect(spaceEvent.defaultPrevented).toBe(true)
    expect(commands.nextFrame).toHaveBeenCalledOnce()
    expect(commands.togglePlaying).toHaveBeenCalledOnce()
    unmount()
  })

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const element = document.createElement('div')
        element.setAttribute('contenteditable', 'true')
        return element
      },
    ],
  ])('does not intercept any shortcut when focus is in %s', (_label, createElement) => {
    // Catches global shortcuts stealing native control or text-editing input.
    const commands = createCommands()
    const target = createElement()
    document.body.append(target)
    const unmount = mountKeyboard(commands)

    const events = interactiveShortcutKeys.map((key) => dispatchKey(key, target))

    expect(events.every((event) => !event.defaultPrevented)).toBe(true)
    expect(Object.values(commands).every((command) => !vi.mocked(command).mock.calls.length)).toBe(
      true,
    )
    unmount()
  })

  it('keeps A/D/W/S active when a workbench button still owns focus', () => {
    // Catches clicking Play/Pause leaving focus on its button and disabling the movement controls.
    const commands = createCommands()
    const button = document.createElement('button')
    document.body.append(button)
    const unmount = mountKeyboard(commands)

    const actionEvents = ['a', 'D', 'w', 'S'].map((key) => dispatchKey(key, button))
    const spaceEvent = dispatchKey(' ', button)

    expect(actionEvents.every((event) => event.defaultPrevented)).toBe(true)
    expect(spaceEvent.defaultPrevented).toBe(false)
    expect(commands.playLeft).toHaveBeenCalledOnce()
    expect(commands.playRight).toHaveBeenCalledOnce()
    expect(commands.playJump).toHaveBeenCalledOnce()
    expect(commands.playCrouch).toHaveBeenCalledOnce()
    expect(commands.togglePlaying).not.toHaveBeenCalled()
    unmount()
  })

  it('ignores repeated toggle shortcuts while keeping frame navigation repeatable', () => {
    // Catches a held Space or L key repeatedly flipping state while arrow/home/end retain key repeat.
    const commands = createCommands()
    const unmount = mountKeyboard(commands)

    expect(dispatchKey(' ', window, { repeat: true }).defaultPrevented).toBe(true)
    expect(dispatchKey('L', window, { repeat: true }).defaultPrevented).toBe(true)
    dispatchKey('ArrowLeft', window, { repeat: true })
    dispatchKey('ArrowRight', window, { repeat: true })
    dispatchKey('Home', window, { repeat: true })
    dispatchKey('End', window, { repeat: true })

    expect(commands.togglePlaying).not.toHaveBeenCalled()
    expect(commands.toggleLoop).not.toHaveBeenCalled()
    expect(commands.previousFrame).toHaveBeenCalledOnce()
    expect(commands.nextFrame).toHaveBeenCalledOnce()
    expect(commands.firstFrame).toHaveBeenCalledOnce()
    expect(commands.lastFrame).toHaveBeenCalledOnce()
    unmount()
  })

  it('keeps A/D repeatable while ignoring repeated W/S action shortcuts', () => {
    // Catches held action keys replaying while held navigation keys remain repeatable.
    const commands = createCommands()
    const unmount = mountKeyboard(commands)

    dispatchKey('a', window, { repeat: true })
    dispatchKey('D', window, { repeat: true })
    expect(dispatchKey('w', window, { repeat: true }).defaultPrevented).toBe(true)
    expect(dispatchKey('S', window, { repeat: true }).defaultPrevented).toBe(true)

    expect(commands.playLeft).toHaveBeenCalledOnce()
    expect(commands.playRight).toHaveBeenCalledOnce()
    expect(commands.playJump).not.toHaveBeenCalled()
    expect(commands.playCrouch).not.toHaveBeenCalled()
    unmount()
  })

  it('ends transient horizontal playback after the last held A/D key is released', () => {
    // Catches held movement starting Walk without restoring the previous paused state on keyup.
    const commands = createCommands()
    const unmount = mountKeyboard(commands)

    dispatchKey('d')
    window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'd' }))

    expect(commands.playRight).toHaveBeenCalledOnce()
    expect(commands.stopHorizontal).toHaveBeenCalledOnce()
    unmount()
  })

  it('handles shortcuts when contenteditable is explicitly false', () => {
    // Catches the attribute selector treating a non-editable element as an editor.
    const commands = createCommands()
    const target = document.createElement('div')
    target.setAttribute('contenteditable', 'false')
    document.body.append(target)
    const unmount = mountKeyboard(commands)

    const events = shortcutKeys.map((key) => dispatchKey(key, target))

    expect(events.every((event) => event.defaultPrevented)).toBe(true)
    expect(commands.togglePlaying).toHaveBeenCalledOnce()
    expect(commands.previousFrame).toHaveBeenCalledOnce()
    expect(commands.nextFrame).toHaveBeenCalledOnce()
    expect(commands.firstFrame).toHaveBeenCalledOnce()
    expect(commands.lastFrame).toHaveBeenCalledOnce()
    expect(commands.toggleLoop).toHaveBeenCalledOnce()
    unmount()
  })

  it('does not listen while disabled and removes its listener when unmounted', () => {
    // Catches shortcuts escaping a disabled workbench or a detached React tree.
    const commands = createCommands()
    const disabledUnmount = mountKeyboard(commands, false)

    expect(dispatchKey('ArrowRight').defaultPrevented).toBe(false)
    expect(commands.nextFrame).not.toHaveBeenCalled()
    disabledUnmount()

    const unmount = mountKeyboard(commands)
    unmount()
    expect(dispatchKey('ArrowRight').defaultPrevented).toBe(false)
    expect(commands.nextFrame).not.toHaveBeenCalled()
  })
})
