/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Character } from '@/entities/character'
import type { Project } from '@/entities/project'

import { PlaytestCatalogPage, type PlaytestCatalogApis } from './catalog'

const project: Project = {
  id: '37',
  ownerId: '1',
  name: '灯笼守夜人',
  perspective: 'side',
  directionalMovement: 'single',
  spriteSize: { width: 256, height: 256 },
  gameStyle: null,
  sampleImageUrl: null,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
}

const targetProject: Project = {
  ...project,
  id: '38',
  name: '第二个项目',
}

const character: Character = {
  id: '25',
  projectId: project.id,
  createdAt: '',
  updatedAt: '',
  outfits: [
    {
      id: 'outfit-25-default',
      characterId: '25',
      name: '默认造型',
      candidateCharacterTemplates: [],
      characterTemplateUrl: 'https://cdn.example.test/character.png',
      baseFrames: [],
      actions: [
        {
          id: '25-custom',
          outfitId: 'outfit-25-default',
          name: '挥舞灯笼',
          kind: 'custom',
          type: 'custom',
          fps: 8,
          keyFrameIndex: 0,
          frames: [
            { imageUrl: 'https://cdn.example.test/frame.png', durationMs: 125, rootMotion: null },
          ],
        },
      ],
    },
  ],
}

function renderCatalog(apis: PlaytestCatalogApis) {
  render(
    <MemoryRouter>
      <PlaytestCatalogPage apis={apis} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PlaytestCatalogPage', () => {
  it('loads published assets across projects and links directly to each action', async () => {
    const apis: PlaytestCatalogApis = {
      projects: {
        list: vi.fn().mockResolvedValue({ items: [project], total: 1, page: 1, pageSize: 1 }),
        remove: vi.fn(),
      },
      characters: {
        listByProject: vi.fn().mockResolvedValue([character]),
        update: vi.fn(),
        remove: vi.fn(),
      },
    }

    renderCatalog(apis)

    expect(await screen.findByRole('heading', { name: 'Playtest' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回项目' }).getAttribute('href')).toBe('/projects')
    expect(screen.getByRole('heading', { name: '灯笼守夜人' })).toBeTruthy()
    expect(screen.getByText('挥舞灯笼')).toBeTruthy()
    expect(screen.getByRole('link', { name: '载入挥舞灯笼' }).getAttribute('href')).toBe(
      '/playtest/25/outfit-25-default?actionId=25-custom',
    )
  })

  it('does not treat an outfit without actions as an importable asset', async () => {
    const emptyCharacter: Character = {
      ...character,
      outfits: [{ ...character.outfits[0]!, actions: [] }],
    }
    renderCatalog({
      projects: {
        list: vi.fn().mockResolvedValue({ items: [project], total: 1, page: 1, pageSize: 1 }),
        remove: vi.fn(),
      },
      characters: {
        listByProject: vi.fn().mockResolvedValue([emptyCharacter]),
        update: vi.fn(),
        remove: vi.fn(),
      },
    })

    expect(await screen.findByText('空文件夹')).toBeTruthy()
  })

  it('opens projects as folders and persists a dragged character in the target project', async () => {
    const update = vi.fn().mockImplementation(async (next: Character) => next)
    renderCatalog({
      projects: {
        list: vi.fn().mockResolvedValue({
          items: [project, targetProject],
          total: 2,
          page: 1,
          pageSize: 2,
        }),
        remove: vi.fn(),
      },
      characters: {
        listByProject: vi
          .fn()
          .mockImplementation(async (projectId: string) =>
            projectId === project.id ? [character] : [],
          ),
        update,
        remove: vi.fn(),
      },
    })

    const cardTitle = await screen.findByText('默认造型')
    const card = cardTitle.closest('article')
    const targetFolder = screen.getByRole('region', { name: '第二个项目项目文件夹' })
    const transfer = {
      effectAllowed: '',
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(character.id),
    }

    fireEvent.dragStart(card!, { dataTransfer: transfer })
    fireEvent.dragEnter(targetFolder, { dataTransfer: transfer })
    fireEvent.drop(targetFolder, { dataTransfer: transfer })

    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0]?.[0].projectId).toBe(targetProject.id)
    expect(await screen.findByText('已将角色资产移动到“第二个项目”')).toBeTruthy()
  })

  it('does not report a move as successful when the backend keeps the old project', async () => {
    renderCatalog({
      projects: {
        list: vi.fn().mockResolvedValue({
          items: [project, targetProject],
          total: 2,
          page: 1,
          pageSize: 2,
        }),
        remove: vi.fn(),
      },
      characters: {
        listByProject: vi
          .fn()
          .mockImplementation(async (projectId: string) =>
            projectId === project.id ? [character] : [],
          ),
        update: vi.fn().mockResolvedValue(character),
        remove: vi.fn(),
      },
    })

    const card = (await screen.findByText('默认造型')).closest('article')
    const targetFolder = screen.getByRole('region', { name: '第二个项目项目文件夹' })
    const transfer = {
      effectAllowed: '',
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(character.id),
    }

    fireEvent.dragStart(card!, { dataTransfer: transfer })
    fireEvent.drop(targetFolder, { dataTransfer: transfer })

    expect(await screen.findByText('后端未保存新的项目归属')).toBeTruthy()
    expect(screen.queryByText('已将角色资产移动到“第二个项目”')).toBeNull()
    expect(screen.getByRole('heading', { name: project.name })).toBeTruthy()
  })

  it('renames an asset and an action through the character update API', async () => {
    const update = vi.fn().mockImplementation(async (next: Character) => next)
    renderCatalog({
      projects: {
        list: vi.fn().mockResolvedValue({ items: [project], total: 1, page: 1, pageSize: 1 }),
        remove: vi.fn(),
      },
      characters: {
        listByProject: vi.fn().mockResolvedValue([character]),
        update,
        remove: vi.fn(),
      },
    })

    await screen.findByText('默认造型')
    fireEvent.click(screen.getByRole('button', { name: '重命名资产名称 默认造型' }))
    fireEvent.change(screen.getByRole('textbox', { name: '资产名称' }), {
      target: { value: '夜巡造型' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存资产名称' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0]?.[0].outfits[0].name).toBe('夜巡造型')

    fireEvent.click(screen.getByRole('button', { name: '重命名动作名称 挥舞灯笼' }))
    fireEvent.change(screen.getByRole('textbox', { name: '动作名称' }), {
      target: { value: '举起灯笼' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存动作名称' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1]?.[0].outfits[0].actions[0].name).toBe('举起灯笼')
  })

  it('deletes a single asset after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const remove = vi.fn().mockResolvedValue(undefined)
    renderCatalog({
      projects: {
        list: vi.fn().mockResolvedValue({ items: [project], total: 1, page: 1, pageSize: 1 }),
        remove: vi.fn(),
      },
      characters: {
        listByProject: vi.fn().mockResolvedValue([character]),
        update: vi.fn(),
        remove,
      },
    })

    await screen.findByText('默认造型')
    fireEvent.click(screen.getByRole('button', { name: '删除资产 默认造型' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith(character.id))
    expect(await screen.findByText('已删除资产“默认造型”')).toBeTruthy()
    expect(screen.queryByText('默认造型')).toBeNull()
  })

  it('delegates atomic project cleanup to one backend request', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const removeCharacter = vi.fn().mockResolvedValue(undefined)
    const removeProject = vi.fn().mockResolvedValue(undefined)
    renderCatalog({
      projects: {
        list: vi.fn().mockResolvedValue({ items: [project], total: 1, page: 1, pageSize: 1 }),
        remove: removeProject,
      },
      characters: {
        listByProject: vi.fn().mockResolvedValue([character]),
        update: vi.fn(),
        remove: removeCharacter,
      },
    })

    await screen.findByText('默认造型')
    fireEvent.click(screen.getByRole('button', { name: `删除项目文件夹 ${project.name}` }))

    await waitFor(() => expect(removeProject).toHaveBeenCalledWith(project.id))
    expect(removeCharacter).not.toHaveBeenCalled()
    expect(await screen.findByText(`已删除项目“${project.name}”`)).toBeTruthy()
    expect(screen.queryByRole('region', { name: `${project.name}项目文件夹` })).toBeNull()
  })
})
