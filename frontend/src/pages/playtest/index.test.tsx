/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Character } from '@/entities/character'
import type { Project } from '@/entities/project'

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

const project: Project = {
  id: 'project-1',
  ownerId: 'user-1',
  name: '探索者项目',
  perspective: 'side',
  directionalMovement: 'single',
  spriteSize: { width: 256, height: 256 },
  gameStyle: null,
  sampleImageUrl: null,
  createdAt: '',
  updatedAt: '',
}

function renderPage(apis?: PlaytestPageApis, initialEntry = '/playtest/character-1/outfit-1') {
  return render(
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
      characters: {
        get: vi.fn().mockResolvedValue(character),
        listByProject: vi.fn().mockResolvedValue([character]),
      },
    }

    renderPage(apis, '/playtest/character-1/outfit-1?actionId=idle')

    expect(screen.getByText('加载 Playtest 数据中')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'character-1 · Explorer' })).toBeTruthy()
    expect(apis.characters.get).toHaveBeenCalledExactlyOnceWith('character-1')
  })

  it.each([{ code: 404 }, { status: 404 }])(
    'maps a missing character response to a stable message',
    async (error) => {
      renderPage({
        characters: { get: vi.fn().mockRejectedValue(error), listByProject: vi.fn() },
      })

      expect(await screen.findByText('角色不存在')).toBeTruthy()
    },
  )

  it('does not mislabel a transport failure as not found', async () => {
    renderPage({
      characters: {
        get: vi.fn().mockRejectedValue(new Error('network unavailable')),
        listByProject: vi.fn(),
      },
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
    const listByProject = vi.fn().mockResolvedValue([character, secondCharacter])
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
            element={<PlaytestPage apis={{ characters: { get, listByProject } }} />}
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

  it('在同一个左栏汇总跨项目资产，并排除没有可播放动作的空资产', async () => {
    const secondCharacter: Character = {
      ...character,
      id: 'character-2',
      projectId: 'project-2',
      outfits: [
        {
          ...character.outfits[0]!,
          id: 'outfit-2',
          characterId: 'character-2',
          name: 'Knight',
          actions: character.outfits[0]!.actions.map((action) => ({
            ...action,
            outfitId: 'outfit-2',
            name: 'Guard',
          })),
        },
      ],
    }
    const emptyCharacter: Character = {
      ...character,
      id: 'character-empty',
      projectId: 'project-empty',
      outfits: [
        {
          ...character.outfits[0]!,
          id: 'outfit-empty',
          characterId: 'character-empty',
          name: 'Empty',
          actions: [
            {
              ...character.outfits[0]!.actions[0]!,
              id: 'empty-action',
              outfitId: 'outfit-empty',
              name: 'Empty action',
              frames: [],
            },
          ],
        },
      ],
    }
    const get = vi
      .fn()
      .mockImplementation(async (id: string) =>
        id === secondCharacter.id ? secondCharacter : character,
      )
    const listByProject = vi.fn().mockImplementation(async (projectId: string) => {
      if (projectId === 'project-2') return [secondCharacter]
      if (projectId === 'project-empty') return [emptyCharacter]
      return [character]
    })
    const projects = [
      project,
      { ...project, id: 'project-2', name: '骑士项目' },
      { ...project, id: 'project-empty', name: '空项目' },
    ]

    renderPage({
      characters: { get, listByProject },
      projects: {
        list: vi.fn().mockResolvedValue({ items: projects, total: 3, page: 1, pageSize: 100 }),
        get: vi.fn().mockResolvedValue(project),
      },
    })

    const selector = await screen.findByRole('combobox', { name: '全部 Playtest 资产' })
    fireEvent.click(selector)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(screen.queryByRole('option', { name: /Empty/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Knight/ }))

    expect(await screen.findByRole('heading', { name: 'character-2 · Knight' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guard8 FPS1 帧' })).toBeTruthy()
    expect(get).toHaveBeenLastCalledWith('character-2')
  })

  it('在左栏通过 Character 更新接口改名资产和动作', async () => {
    const update = vi.fn(async (input: Character) => input)
    renderPage({
      characters: {
        get: vi.fn().mockResolvedValue(character),
        listByProject: vi.fn().mockResolvedValue([character]),
        update,
      },
    })

    await screen.findByRole('heading', { name: 'character-1 · Explorer' })
    fireEvent.click(screen.getByRole('button', { name: '重命名资产 Explorer' }))
    fireEvent.change(screen.getByRole('textbox', { name: '资产名称' }), {
      target: { value: 'Night Explorer' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[0].outfits[0]?.name).toBe('Night Explorer')

    fireEvent.click(screen.getByRole('button', { name: '重命名动作 Idle' }))
    fireEvent.change(screen.getByRole('textbox', { name: '动作名称' }), {
      target: { value: 'Breathe' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1]?.[0].outfits[0]?.actions[0]?.name).toBe('Breathe')
  })

  it('删除动作和最后一个造型时分别调用更新与角色删除接口', async () => {
    const update = vi.fn(async (input: Character) => input)
    const remove = vi.fn(async () => undefined)
    const get = vi.fn().mockResolvedValue(character)
    const listByProject = vi.fn().mockResolvedValue([character])

    const { unmount } = renderPage({
      characters: { get, listByProject, update, remove },
    })
    await screen.findByRole('heading', { name: 'character-1 · Explorer' })
    fireEvent.click(screen.getByRole('button', { name: '删除动作 Idle' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[0].outfits[0]?.actions).toHaveLength(0)

    unmount()
    renderPage({ characters: { get, listByProject, update, remove } })
    await screen.findByRole('heading', { name: 'character-1 · Explorer' })
    fireEvent.click(screen.getByRole('button', { name: '删除资产 Explorer' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('character-1'))
  })
})
