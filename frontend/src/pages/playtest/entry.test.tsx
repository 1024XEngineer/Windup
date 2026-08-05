/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Character } from '@/entities/character'
import type { Project } from '@/entities/project'

import { PlaytestEntryPage, type PlaytestEntryApis } from './entry'

const project: Project = {
  id: '37',
  ownerId: '1',
  name: '灯笼守夜人',
  perspective: 'side',
  directionalMovement: 'single',
  spriteSize: { width: 256, height: 256 },
  gameStyle: null,
  sampleImageUrl: null,
  createdAt: '',
  updatedAt: '',
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
            {
              imageUrl: 'https://cdn.example.test/frame.png',
              durationMs: 125,
              rootMotion: null,
            },
          ],
        },
      ],
    },
  ],
}

function LocationProbe() {
  const location = useLocation()
  return <p>{`${location.pathname}${location.search}`}</p>
}

function renderEntry(apis: PlaytestEntryApis) {
  render(
    <MemoryRouter initialEntries={['/playtest']}>
      <Routes>
        <Route path="/playtest" element={<PlaytestEntryPage apis={apis} />} />
        <Route path="/playtest/:characterId/:outfitId" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PlaytestEntryPage', () => {
  it('直接进入第一个包含动作的 Playtest 工作台', async () => {
    renderEntry({
      projects: {
        list: vi.fn().mockResolvedValue({ items: [project], total: 1, page: 1, pageSize: 100 }),
      },
      characters: { listByProject: vi.fn().mockResolvedValue([character]) },
    })

    expect(
      await screen.findByText('/playtest/25/outfit-25-default?actionId=25-custom'),
    ).toBeTruthy()
    expect(screen.queryByText('项目文件夹')).toBeNull()
  })

  it('没有动作时只显示工作台空状态', async () => {
    renderEntry({
      projects: {
        list: vi.fn().mockResolvedValue({ items: [project], total: 1, page: 1, pageSize: 100 }),
      },
      characters: {
        listByProject: vi
          .fn()
          .mockResolvedValue([
            { ...character, outfits: [{ ...character.outfits[0]!, actions: [] }] },
          ]),
      },
    })

    expect(await screen.findByText('没有可预览的动作，请先完成一次动作生成')).toBeTruthy()
    expect(screen.queryByText('项目文件夹')).toBeNull()
  })

  it('本地项目接口不可用时进入内置 Playtest 工作台', async () => {
    render(
      <MemoryRouter initialEntries={['/playtest']}>
        <Routes>
          <Route
            path="/playtest"
            element={
              <PlaytestEntryPage
                apis={{
                  projects: { list: vi.fn().mockRejectedValue(new Error('backend offline')) },
                  characters: { listByProject: vi.fn() },
                }}
              />
            }
          />
          <Route path="/playtest/demo" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('/playtest/demo')).toBeTruthy()
    expect(screen.queryByText('Playtest 数据读取失败')).toBeNull()
  })
})
