// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Character } from '@/entities'

import { PlaytestWorkbench } from './index'

const OUTFIT_ID = 'outfit-default'
const IDLE_ACTION_ID = 'idle'

function frame(index: number, imageUrl: string) {
  return { index, imageUrl, durationMs: 100 }
}

const character: Character = {
  id: '51',
  projectId: '42',
  workflowRunId: 'workflow-run-51',
  name: '轻装信使',
  description: null,
  referenceImageUrl: null,
  dataVersion: 1,
  status: 1,
  outfits: [
    {
      id: OUTFIT_ID,
      characterId: '51',
      name: '常态造型',
      description: null,
      previewUrl: '/master.png',
      model3dUrl: null,
      actions: [
        {
          id: IDLE_ACTION_ID,
          outfitId: OUTFIT_ID,
          name: '待机',
          type: 'idle',
          loop: true,
          fps: 8,
          frameCount: 2,
          frames: [frame(0, '/idle-01.png'), frame(1, '/idle-02.png')],
        },
        {
          id: 'walk',
          outfitId: OUTFIT_ID,
          name: '行走',
          type: 'walk',
          loop: true,
          fps: 10,
          frameCount: 2,
          frames: [frame(0, '/walk-01.png'), frame(1, '/walk-02.png')],
        },
        {
          id: 'jump',
          outfitId: OUTFIT_ID,
          name: '跳跃',
          type: 'jump',
          loop: false,
          fps: 10,
          frameCount: 2,
          frames: [frame(0, '/jump-01.png'), frame(1, '/jump-02.png')],
        },
        {
          id: 'attack',
          outfitId: OUTFIT_ID,
          name: '攻击',
          type: 'attack',
          loop: false,
          fps: 10,
          frameCount: 2,
          frames: [frame(0, '/attack-01.png'), frame(1, '/attack-02.png')],
        },
      ],
    },
  ],
}

const characterWithoutLocomotion: Character = {
  ...character,
  outfits: character.outfits.map((outfit) => ({
    ...outfit,
    actions: outfit.actions.filter((action) => action.type !== 'walk'),
  })),
}

function renderWorkbench(userId: string | null = '7') {
  render(
    <PlaytestWorkbench
      character={character}
      outfitId={OUTFIT_ID}
      movementMode="single"
      initialActionId={IDLE_ACTION_ID}
      userId={userId}
    />,
  )
}

function pressedState(actionName: string) {
  return screen
    .getByRole('button', { name: `绑定动作：${actionName}` })
    .getAttribute('aria-pressed')
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('PlaytestWorkbench minimal control path', () => {
  it('shows a clear error when the requested outfit does not exist', () => {
    render(
      <PlaytestWorkbench
        character={character}
        outfitId="missing-outfit"
        movementMode="single"
        initialActionId={IDLE_ACTION_ID}
      />,
    )

    expect(screen.getByRole('main', { name: '预览台' }).textContent).toContain(
      '找不到指定造型，无法进入预览台。',
    )
  })

  it('shows one stage, the bound actions, and direct character controls', () => {
    renderWorkbench()

    expect(screen.getByRole('region', { name: '预览舞台' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '角色操控' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '绑定动作：待机' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '绑定动作：行走' })).toBeTruthy()
  })

  it('uses the same bound character actions for keyboard movement', () => {
    renderWorkbench()

    fireEvent.keyDown(window, { key: 'd' })
    expect(pressedState('行走')).toBe('true')

    fireEvent.keyUp(window, { key: 'd' })
    expect(pressedState('待机')).toBe('true')
  })

  it('keeps moving until the keyboard and visible control are both released', () => {
    renderWorkbench()
    const right = screen.getByRole('button', { name: '向右移动' })
    Object.assign(right, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    })

    fireEvent.pointerDown(right, { pointerId: 41 })
    fireEvent.keyDown(window, { key: 'd', code: 'KeyD' })
    fireEvent.keyUp(window, { key: 'd', code: 'KeyD' })

    expect(pressedState('行走')).toBe('true')

    fireEvent.pointerUp(right, { pointerId: 41 })
    expect(pressedState('待机')).toBe('true')
  })

  it('shows action assignments separately and disables directions without assets', () => {
    renderWorkbench()

    expect((screen.getByLabelText('主动作分配动作') as HTMLSelectElement).value).toBe('jump')
    expect((screen.getByLabelText('次动作分配动作') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByLabelText('A 分配动作')).toBeNull()
    expect(screen.queryByLabelText('D 分配动作')).toBeNull()
    expect((screen.getByRole('button', { name: '次动作键' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: '向左移动' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
    expect((screen.getByRole('button', { name: '向上移动' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: '向下移动' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('keeps horizontal controls available for turning without a locomotion action', () => {
    render(
      <PlaytestWorkbench
        character={characterWithoutLocomotion}
        outfitId={OUTFIT_ID}
        movementMode="single"
        initialActionId={IDLE_ACTION_ID}
      />,
    )

    const left = screen.getByRole('button', { name: '向左移动' }) as HTMLButtonElement
    const right = screen.getByRole('button', { name: '向右移动' }) as HTMLButtonElement
    expect(left.disabled).toBe(false)
    expect(right.disabled).toBe(false)
    expect((screen.getByRole('button', { name: '向上移动' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect((screen.getByRole('button', { name: '向下移动' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    Object.assign(left, { setPointerCapture: vi.fn() })
    fireEvent.pointerDown(left, { pointerId: 31 })
    expect(
      screen.getByRole('region', { name: '预览舞台' }).querySelector('img')?.style.transform,
    ).toContain('scaleX(-1)')
  })

  it('uses an adjusted assignment immediately without reloading the action frames', () => {
    renderWorkbench()

    fireEvent.change(screen.getByLabelText('主动作分配动作'), {
      target: { value: 'attack' },
    })
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })

    expect(pressedState('攻击')).toBe('true')
  })

  it('allows an assignment to be cleared and releases pointers without capture', () => {
    renderWorkbench()

    const space = screen.getByRole('button', { name: '主动作键' })
    const releaseControlPointerCapture = vi.fn()
    Object.assign(space, {
      hasPointerCapture: () => false,
      releasePointerCapture: releaseControlPointerCapture,
    })
    fireEvent.pointerUp(space, { pointerId: 20 })
    expect(releaseControlPointerCapture).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('主动作分配动作'), {
      target: { value: '' },
    })
    expect((screen.getByRole('button', { name: '主动作键' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    const right = screen.getByRole('button', { name: '向右移动' })
    const releasePointerCapture = vi.fn()
    Object.assign(right, {
      hasPointerCapture: () => false,
      releasePointerCapture,
    })
    fireEvent.pointerUp(right, { pointerId: 21 })
    expect(releasePointerCapture).not.toHaveBeenCalled()
  })

  it('uses the same control path for pointer press and release', () => {
    renderWorkbench()

    const left = screen.getByRole('button', { name: '向左移动' })
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(left, {
      setPointerCapture,
      hasPointerCapture: () => true,
      releasePointerCapture,
    })

    fireEvent.pointerDown(left, { pointerId: 7 })
    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(left.getAttribute('aria-pressed')).toBe('true')
    expect(pressedState('行走')).toBe('true')

    fireEvent.pointerUp(left, { pointerId: 7 })
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(left.getAttribute('aria-pressed')).toBe('false')
    expect(pressedState('待机')).toBe('true')

    fireEvent.pointerDown(left, { pointerId: 8 })
    fireEvent.pointerCancel(left, { pointerId: 8 })
    expect(releasePointerCapture).toHaveBeenCalledWith(8)
    expect(pressedState('待机')).toBe('true')

    fireEvent.pointerDown(left, { pointerId: 9 })
    fireEvent.lostPointerCapture(left, { pointerId: 9 })
    expect(left.getAttribute('aria-pressed')).toBe('false')
  })

  it('uses the assigned action for pointer press, release, cancel, and lost capture', () => {
    renderWorkbench()

    const space = screen.getByRole('button', { name: '主动作键' })
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(space, {
      setPointerCapture,
      hasPointerCapture: () => true,
      releasePointerCapture,
    })

    fireEvent.pointerDown(space, { pointerId: 11 })
    expect(setPointerCapture).toHaveBeenCalledWith(11)
    expect(pressedState('跳跃')).toBe('true')

    fireEvent.pointerUp(space, { pointerId: 11 })
    expect(releasePointerCapture).toHaveBeenCalledWith(11)

    fireEvent.pointerDown(space, { pointerId: 12 })
    fireEvent.pointerCancel(space, { pointerId: 12 })
    expect(releasePointerCapture).toHaveBeenCalledWith(12)

    fireEvent.pointerDown(space, { pointerId: 13 })
    fireEvent.lostPointerCapture(space, { pointerId: 13 })
    expect(space.getAttribute('aria-pressed')).toBe('true')
  })

  it('captures a physical key and restores it for the same local account', () => {
    renderWorkbench('7')

    fireEvent.click(screen.getByRole('button', { name: '修改向右移动键位' }))
    fireEvent.keyDown(window, { key: 'l', code: 'KeyL' })

    expect(screen.getByText('已保存到此浏览器')).toBeTruthy()
    expect(screen.getByRole('button', { name: '修改向右移动键位' }).textContent).toContain('L')
    expect(pressedState('待机')).toBe('true')

    cleanup()
    renderWorkbench('7')
    expect(screen.getByRole('button', { name: '修改向右移动键位' }).textContent).toContain('L')
  })

  it('keeps persisted keybindings isolated between local accounts', () => {
    renderWorkbench('7')
    fireEvent.click(screen.getByRole('button', { name: '修改向右移动键位' }))
    fireEvent.keyDown(window, { key: 'l', code: 'KeyL' })

    cleanup()
    renderWorkbench('8')

    expect(screen.getByRole('button', { name: '修改向右移动键位' }).textContent).toContain('D')
  })

  it('swaps occupied controls and lets Escape cancel capture', () => {
    renderWorkbench()

    fireEvent.click(screen.getByRole('button', { name: '修改向右移动键位' }))
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW' })
    expect(screen.getByRole('button', { name: '修改向右移动键位' }).textContent).toContain('W')
    expect(screen.getByRole('button', { name: '修改向上移动键位' }).textContent).toContain('D')

    fireEvent.click(screen.getByRole('button', { name: '修改向左移动键位' }))
    expect(screen.getByText('请按新键')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    expect(screen.queryByText('请按新键')).toBeNull()
    expect(screen.getByRole('button', { name: '修改向左移动键位' }).textContent).toContain('A')
  })

  it('reports when browser persistence is unavailable instead of claiming success', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderWorkbench()

    fireEvent.click(screen.getByRole('button', { name: '修改向右移动键位' }))
    fireEvent.keyDown(window, { key: 'l', code: 'KeyL' })

    expect(screen.getByText('仅本次有效，浏览器未保存')).toBeTruthy()
    expect(screen.queryByText('已保存到此浏览器')).toBeNull()
  })

  it('clears an action key and restores all defaults without touching the backend', () => {
    renderWorkbench()

    fireEvent.click(screen.getByRole('button', { name: '修改主动作键位' }))
    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' })
    expect(screen.getByRole('button', { name: '修改主动作键位' }).textContent).toContain('未绑定')

    fireEvent.click(screen.getByRole('button', { name: '恢复默认键位' }))
    expect(screen.getByRole('button', { name: '修改主动作键位' }).textContent).toContain('Space')
    expect(screen.getByText('已恢复此浏览器默认键位')).toBeTruthy()
  })
})
