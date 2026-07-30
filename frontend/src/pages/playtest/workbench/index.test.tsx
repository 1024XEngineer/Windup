/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Character } from '@/entities/character'

import type { FrameGeometryResult } from './analysis/sequence-evidence'
import { PlaytestWorkbench } from './index'

const readImageGeometry = vi.hoisted(() => vi.fn())
vi.mock('./analysis/image-geometry', () => ({ readImageGeometry }))

const character: Character = {
  id: 'character-1',
  projectId: 'project-1',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  outfits: [
    {
      id: 'outfit-1',
      characterId: 'character-1',
      name: 'Explorer',
      candidateCharacterTemplates: [],
      characterTemplateUrl: 'https://cdn.example.test/aster.png',
      baseFrames: [{ imageUrl: 'https://cdn.example.test/base.png' }],
      actions: [
        {
          id: 'walk',
          outfitId: 'outfit-1',
          name: 'Walk',
          kind: 'preset',
          type: 'walk',
          fps: 8,
          keyFrameIndex: 0,
          frames: [
            {
              imageUrl: 'https://cdn.example.test/walk-01.png',
              durationMs: 125,
              rootMotion: { dx: 2, dy: 0 },
            },
            {
              imageUrl: 'https://cdn.example.test/walk-02.png',
              durationMs: 125,
              rootMotion: { dx: 4, dy: 0 },
            },
          ],
        },
        {
          id: 'jump',
          outfitId: 'outfit-1',
          name: 'Jump',
          kind: 'preset',
          type: 'jump',
          fps: 8,
          keyFrameIndex: 0,
          frames: [
            {
              imageUrl: 'https://cdn.example.test/jump-01.png',
              durationMs: 125,
              rootMotion: { dx: 0, dy: 3 },
            },
          ],
        },
        {
          id: 'crouch',
          outfitId: 'outfit-1',
          name: 'Crouch',
          kind: 'custom',
          type: 'custom',
          fps: 8,
          keyFrameIndex: 0,
          frames: [
            {
              imageUrl: 'https://cdn.example.test/crouch-01.png',
              durationMs: 125,
              rootMotion: null,
            },
          ],
        },
      ],
    },
  ],
}

function measuredGeometry(imageUrl: string): FrameGeometryResult {
  return {
    status: 'ready',
    geometry: {
      width: 256,
      height: 256,
      bounds: { left: 80, top: 30, right: 175, bottom: 236, width: 96, height: 207 },
      centroid: { x: imageUrl.includes('02') ? 129 : 128, y: 130 },
      footY: 236,
      subjectHeight: 207,
      opaquePixels: 13_000,
      coverageRatio: 0.2,
    },
  }
}

beforeEach(() => {
  readImageGeometry.mockImplementation(async (imageUrl: string) => measuredGeometry(imageUrl))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PlaytestWorkbench on the PR #70 character contract', () => {
  it('renders confirmed asset actions through one synthetic default direction', async () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" />)

    expect(screen.getByRole('heading', { name: 'character-1 · Explorer' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Walk/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Jump/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Crouch/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'default' })).toBeTruthy()
    expect(screen.getByText('只读预览，不写入角色、动作或帧')).toBeTruthy()
    await waitFor(() => expect(readImageGeometry).toHaveBeenCalled())
  })

  it('keeps playback controls and the shared current frame in sync', () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" />)

    expect(screen.getByText('01 / 02')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一帧' }))
    expect(screen.getByText('02 / 02')).toBeTruthy()

    const timeline = screen.getByRole('region', { name: '逐帧时间线' })
    fireEvent.click(within(timeline).getByRole('button', { name: '第 1 帧' }))
    expect(screen.getByText('01 / 02')).toBeTruthy()
  })

  it('maps A/D to walk facing, W to jump, and custom Crouch to S', () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" />)

    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByRole('button', { name: /Walk/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyUp(window, { key: 'd' })

    fireEvent.keyDown(window, { key: 'w' })
    expect(screen.getByRole('button', { name: /Jump/ }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(window, { key: 's' })
    expect(screen.getByRole('button', { name: /Crouch/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps acceptance as session-only state without a persistence API', () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" />)

    fireEvent.click(screen.getByRole('button', { name: '发现问题' }))
    const acceptance = screen.getByRole('region', { name: '核验状态' })
    expect(within(acceptance).getAllByText('发现问题')).toHaveLength(2)
    expect(within(acceptance).getByText('仅保存在当前页面，不写入后端')).toBeTruthy()
  })

  it('reports a missing outfit instead of falling back to another asset', () => {
    render(<PlaytestWorkbench character={character} outfitId="missing" />)

    expect(screen.getByText('找不到指定造型，无法构造只读预览。')).toBeTruthy()
  })

  it('keeps inspect, audit, and export in the same workbench', () => {
    render(<PlaytestWorkbench character={character} outfitId="outfit-1" />)

    expect(screen.getByRole('tab', { name: '帧检查' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '问题记录' }))
    expect(screen.getByRole('tabpanel', { name: '问题记录' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '资产导出' }))
    expect(screen.getByRole('button', { name: '导出游戏资产包' })).toBeTruthy()
  })
})
