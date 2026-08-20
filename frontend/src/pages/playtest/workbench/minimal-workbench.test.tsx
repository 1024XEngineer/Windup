// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

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
      ],
    },
  ],
}

function renderWorkbench() {
  render(
    <PlaytestWorkbench
      character={character}
      outfitId={OUTFIT_ID}
      initialActionId={IDLE_ACTION_ID}
    />,
  )
}

function pressedState(actionName: string) {
  return screen
    .getByRole('button', { name: `绑定动作：${actionName}` })
    .getAttribute('aria-pressed')
}

afterEach(cleanup)

describe('PlaytestWorkbench minimal control path', () => {
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

  it('keeps moving until every key bound to the same direction is released', () => {
    renderWorkbench()

    fireEvent.keyDown(window, { key: 'd', code: 'KeyD' })
    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight' })
    fireEvent.keyUp(window, { key: 'd', code: 'KeyD' })

    expect(pressedState('行走')).toBe('true')

    fireEvent.keyUp(window, { key: 'ArrowRight', code: 'ArrowRight' })
    expect(pressedState('待机')).toBe('true')
  })
})
