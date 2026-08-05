/**
 * 前后端契约测试：用真实后端响应快照（__fixtures__/）验证 adapter 解析。
 *
 * 样本取自本地后端真实响应（character 25 / task 70 / project 列表）。
 * 后端 DTO 形状一旦变化，这里立刻暴露 —— 不再依赖手工联调发现。
 */
import { describe, expect, it, vi } from 'vitest'

import character25 from './__fixtures__/character-25.json'
import characterList from './__fixtures__/character-list.json'
import task71 from './__fixtures__/task-71.json'
import projectList from './__fixtures__/project-list.json'

/** 信封解包（与 http-client 相同语义：返回 data 字段） */
function unwrap<T>(envelope: { data: T }): T {
  return envelope.data
}

vi.mock('@/shared/api', () => ({
  get: vi.fn(async (path: string) => {
    if (path.startsWith('/characters?project_id')) return unwrap(characterList)
    if (path.startsWith('/characters/')) return unwrap(character25)
    if (path.startsWith('/generation/tasks/')) return unwrap(task71)
    if (path.startsWith('/projects')) return unwrap(projectList)
    throw new Error(`未收录的契约样本路径：${path}`)
  }),
  getPage: vi.fn(async (path: string) => {
    const envelope = path.startsWith('/characters?project_id') ? characterList : projectList
    return {
      items: envelope.data,
      total: envelope.total,
      page: envelope.page,
      pageSize: envelope.page_size,
    }
  }),
  post: vi.fn(),
  patch: vi.fn(),
}))

import { createCharacterApis, createGenerationApis, createProjectApis } from '@/entities'

describe('adapter contract (real backend snapshots)', () => {
  it('character.get parses outfit, action and frames from real payload', async () => {
    const apis = createCharacterApis()
    const character = await apis.get('25')

    expect(character.id).toBe('25')
    expect(character.projectId).toBe('37')
    expect(character.outfits).toHaveLength(1)

    const outfit = character.outfits[0]!
    expect(outfit.id).toBe('outfit-25-default')
    expect(outfit.name).toBe('默认造型')
    expect(outfit.characterTemplateUrl).toContain('reference-image')

    const action = outfit.actions[0]!
    expect(action.id).toBe('25-custom')
    expect(action.type).toBe('custom')
    expect(action.name).toBe('自定义动作')
    expect(action.frames.length).toBeGreaterThan(5)
    expect(action.frames[0]!.imageUrl).toContain('action-frame')
    expect(action.frames[0]!.durationMs).toBeTypeOf('number')
  })

  it('character.listByProject returns an array directly (envelope already unwrapped)', async () => {
    const apis = createCharacterApis()
    const characters = await apis.listByProject('37')

    expect(Array.isArray(characters)).toBe(true)
    expect(characters.length).toBeGreaterThan(0)
    expect(characters[0]!.outfits[0]!.id).toBe('outfit-25-default')
  })

  it('generation.get maps the backend task endpoint into one entity', async () => {
    const apis = createGenerationApis()
    const generation = await apis.get('37', '71')

    expect(generation.id).toBe('71')
    expect(generation.projectId).toBe('37')
    expect(generation.status).toBe('completed')
    expect(generation.type).toBe('complete_animation')
  })

  it('project.list returns paged projects with sprite size', async () => {
    const apis = createProjectApis()
    const paged = await apis.list()

    expect(paged.items.length).toBeGreaterThan(0)
    const project = paged.items[0]!
    expect(project.spriteSize.width).toBeGreaterThan(0)
    expect(project.spriteSize.height).toBeGreaterThan(0)
    expect(project.id).toBeTruthy()
  })
})
