/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActionSelector } from './action-selector'
import { AnimationStage } from './animation-stage'
import { FrameTimeline } from './frame-timeline'
import { PlaybackControls } from './playback-controls'
import type { PreviewAction, PreviewFrame, PreviewSequence } from './model/types'

const currentFrame: PreviewFrame = {
  imageUrl: 'https://cdn.example.test/current.png',
  durationMs: 100,
  rootMotion: { dx: 12, dy: 5 },
  keyFrame: true,
}

const nextFrame: PreviewFrame = {
  ...currentFrame,
  imageUrl: 'https://cdn.example.test/next.png',
  keyFrame: false,
}

const sequence: PreviewSequence = {
  direction: 'south',
  frames: [currentFrame, nextFrame],
}

const actions: readonly PreviewAction[] = [
  {
    id: 'walk',
    name: '行走',
    type: 'walk',
    fps: 12,
    sequences: [sequence],
  },
  {
    id: 'empty',
    name: '空动作',
    type: 'idle',
    fps: 12,
    sequences: [],
  },
]

afterEach(cleanup)

describe('playtest visual primitives', () => {
  it('renders prop-supplied action names, FPS and actual frame counts while disabling empty actions', () => {
    // Catches a selector replacing supplied actions with demo data or permitting a non-playable action.
    const onSelectAction = vi.fn()

    render(
      <ActionSelector actions={actions} selectedActionId="walk" onSelectAction={onSelectAction} />,
    )

    expect(screen.getByRole('button', { name: /行走/ }).textContent).toContain('12 FPS')
    expect(screen.getByRole('button', { name: /行走/ }).textContent).toContain('2 帧')
    expect((screen.getByRole('button', { name: /空动作/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.click(screen.getByRole('button', { name: /行走/ }))
    expect(onSelectAction).toHaveBeenCalledWith('walk')
  })

  it('uses the real frame URL and reports image failure with the accumulated mirrored transform', () => {
    // Catches the stage reading per-frame root motion instead of the accumulated owner state, inverting y incorrectly, or hiding load errors.
    render(
      <AnimationStage
        currentFrame={currentFrame}
        motionOffset={{ x: 18, y: 7 }}
        mirrored
        showGrid
        showChecker
      />,
    )

    const image = screen.getByRole('img', { name: '角色动画预览' })
    expect(image.getAttribute('src')).toBe(currentFrame.imageUrl)
    expect(image.getAttribute('style')).toContain('translate(18px, -7px) scaleX(-1)')
    expect(screen.getAllByRole('img')).toHaveLength(1)

    fireEvent.error(image)
    expect(screen.getByText('当前帧图片加载失败')).toBeTruthy()
  })

  it('reports horizontal travel from the measured stage and actor widths', () => {
    const onHorizontalBoundsChange = vi.fn()
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const width = this.getAttribute('aria-label') === '动画预览舞台' ? 600 : 200
        return {
          width,
          height: 400,
          x: 0,
          y: 0,
          top: 0,
          right: width,
          bottom: 400,
          left: 0,
          toJSON: () => ({}),
        }
      })

    render(
      <AnimationStage
        currentFrame={currentFrame}
        motionOffset={{ x: 0, y: 0 }}
        mirrored={false}
        showGrid={false}
        showChecker={false}
        onHorizontalBoundsChange={onHorizontalBoundsChange}
      />,
    )

    fireEvent.load(screen.getByRole('img', { name: '角色动画预览' }))
    expect(onHorizontalBoundsChange).toHaveBeenLastCalledWith({ minX: -200, maxX: 200 })
    rect.mockRestore()
  })

  it('surfaces key-frame markers and delegates timeline selection without its own playback behavior', () => {
    // Catches a timeline dropping key-frame annotations or mutating playback rather than using its selection callback.
    const onSelectFrame = vi.fn()

    render(
      <FrameTimeline sequence={sequence} currentFrameIndex={0} onSelectFrame={onSelectFrame} />,
    )

    expect(screen.getByText('关键帧')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '第 2 帧' }))
    expect(onSelectFrame).toHaveBeenCalledWith(1)
  })

  it('only relays playback controller callbacks', () => {
    // Catches controls owning local play state instead of reporting user intent to the controller.
    const onTogglePlaying = vi.fn()
    const onNextFrame = vi.fn()

    render(
      <PlaybackControls
        playing={false}
        loop
        frameIndex={0}
        frameCount={2}
        fps={12}
        jumpAvailable={false}
        crouchAvailable
        onFirstFrame={vi.fn()}
        onPreviousFrame={vi.fn()}
        onTogglePlaying={onTogglePlaying}
        onNextFrame={onNextFrame}
        onLastFrame={vi.fn()}
        onToggleLoop={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    fireEvent.click(screen.getByRole('button', { name: '下一帧' }))
    expect(onTogglePlaying).toHaveBeenCalledTimes(1)
    expect(onNextFrame).toHaveBeenCalledTimes(1)
    expect(screen.getByText('A 左行走')).toBeTruthy()
    expect(screen.getByText('D 右行走')).toBeTruthy()
    expect(screen.getByText('未提供跳跃动作')).toBeTruthy()
    expect(screen.getByText('下蹲动作可用')).toBeTruthy()
  })
})
