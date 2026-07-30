/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Character } from '@/entities/character'

import { PlaytestPage, type PlaytestPageApis } from './index'

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
          id: 'idle',
          outfitId: 'outfit-1',
          name: 'Idle',
          kind: 'preset',
          type: 'idle',
          fps: 8,
          keyFrameIndex: 0,
          frames: [
            {
              imageUrl: 'https://cdn.example.test/idle.png',
              durationMs: 125,
              rootMotion: null,
            },
          ],
        },
      ],
    },
  ],
}

function renderPage(apis?: PlaytestPageApis, initialEntry = '/playtest/character-1/outfit-1') {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/playtest/:characterId/:outfitId" element={<PlaytestPage apis={apis} />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => cleanup())

describe('PlaytestPage', () => {
  it('shows an explicit unconfigured boundary instead of inventing character data', () => {
    renderPage()

    expect(screen.getByText('Playtest 角色接口尚未配置')).toBeTruthy()
  })

  it('loads the requested character through the standard skeleton API only', async () => {
    const apis: PlaytestPageApis = {
      characters: { get: vi.fn().mockResolvedValue(character) },
    }

    renderPage(apis, '/playtest/character-1/outfit-1?actionId=idle')

    expect(screen.getByText('加载 Playtest 数据中')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'character-1 · Explorer' })).toBeTruthy()
    expect(apis.characters.get).toHaveBeenCalledExactlyOnceWith('character-1')
  })

  it.each([{ code: 404 }, { status: 404 }])(
    'maps a missing character response to a stable message',
    async (error) => {
      renderPage({ characters: { get: vi.fn().mockRejectedValue(error) } })

      expect(await screen.findByText('角色不存在')).toBeTruthy()
    },
  )

  it('does not mislabel a transport failure as not found', async () => {
    renderPage({
      characters: { get: vi.fn().mockRejectedValue(new Error('network unavailable')) },
    })

    expect(await screen.findByText('角色读取失败')).toBeTruthy()
  })

  it('ignores a stale character response after the route identity changes', async () => {
    let resolveFirst: ((value: Character) => void) | undefined
    const firstRequest = new Promise<Character>((resolve) => {
      resolveFirst = resolve
    })
    const secondCharacter: Character = {
      ...character,
      id: 'character-2',
      outfits: [{ ...character.outfits[0], characterId: 'character-2' }],
    }
    const get = vi.fn().mockReturnValueOnce(firstRequest).mockResolvedValueOnce(secondCharacter)
    let navigate: NavigateFunction | undefined

    function NavigationProbe() {
      navigate = useNavigate()
      return null
    }

    render(
      <MemoryRouter initialEntries={['/playtest/character-1/outfit-1']}>
        <NavigationProbe />
        <Routes>
          <Route
            path="/playtest/:characterId/:outfitId"
            element={<PlaytestPage apis={{ characters: { get } }} />}
          />
        </Routes>
      </MemoryRouter>,
    )

    await act(async () => navigate?.('/playtest/character-2/outfit-1'))
    expect(await screen.findByRole('heading', { name: 'character-2 · Explorer' })).toBeTruthy()

    await act(async () => resolveFirst?.(character))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'character-2 · Explorer' })).toBeTruthy(),
    )
    expect(get).toHaveBeenNthCalledWith(1, 'character-1')
    expect(get).toHaveBeenNthCalledWith(2, 'character-2')
  })
})
