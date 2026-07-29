// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'

import type { Character, CharacterRepository, PlaytestInspectionRepository } from '@/entities'
import { PlaytestPage } from './index'

const character: Character = {
  id: 'character-1',
  projectId: 'project-1',
  name: '小骑士',
  outfits: [
    {
      id: 'outfit-1',
      characterId: 'character-1',
      name: '默认造型',
      candidateCharacterTemplates: [],
      characterTemplateUrl: null,
      baseFrames: [],
      actions: [],
    },
  ],
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
}

describe('PlaytestPage', () => {
  afterEach(cleanup)

  it('独立入口只需 characterId 和 outfitId 就能读取播放数据', async () => {
    const characters: CharacterRepository = {
      async get() {
        return character
      },
      async listByProject() {
        return [character]
      },
      async create() {
        return character
      },
      async update() {
        return character
      },
    }
    const inspections: PlaytestInspectionRepository = {
      async getLatest() {
        return null
      },
      async record(input) {
        return {
          id: 'inspection-1',
          characterId: input.characterId,
          outfitId: input.outfitId,
          source: input.source ?? null,
          status: input.status,
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:00:00.000Z',
        }
      },
    }

    render(
      <MemoryRouter initialEntries={['/playtest/character-1/outfit-1']}>
        <Routes>
          <Route
            path="/playtest/:characterId/:outfitId"
            element={<PlaytestPage characters={characters} inspections={inspections} />}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/造型 默认造型/)).toBeTruthy()
    expect(screen.queryByText(/缺少角色、工作流或版本参数/)).toBeNull()
  })

  it('保存核验结论失败时展示错误，不产生未处理拒绝', async () => {
    const characters: CharacterRepository = {
      async get() {
        return character
      },
      async listByProject() {
        return [character]
      },
      async create() {
        return character
      },
      async update() {
        return character
      },
    }
    const inspections: PlaytestInspectionRepository = {
      async getLatest() {
        return null
      },
      async record() {
        throw new Error('核验记录保存失败')
      },
    }

    render(
      <MemoryRouter initialEntries={['/playtest/character-1/outfit-1']}>
        <Routes>
          <Route
            path="/playtest/:characterId/:outfitId"
            element={<PlaytestPage characters={characters} inspections={inspections} />}
          />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '记录为通过' }))

    expect(await screen.findByText('保存失败：核验记录保存失败')).toBeTruthy()
  })
})
