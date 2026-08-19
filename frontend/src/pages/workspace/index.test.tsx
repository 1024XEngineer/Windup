// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createProjectAssetsBackend } from '@/test/project-assets-backend'

import { WorkspacePage } from './index'

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

interface RenderWorkspaceOptions {
  characterCount?: number
  defer?: 'characters' | 'projects' | 'workflows'
  deferFirst?: 'characters' | 'projects' | 'workflows'
  fail?: 'characters' | 'projects' | 'workflows'
  failOnce?: 'characters' | 'projects' | 'workflows'
  outfitCount?: number
  projectCount?: number
  workflowRunCount?: number
}

function renderWorkspace({
  characterCount,
  defer,
  deferFirst,
  fail,
  failOnce,
  outfitCount,
  projectCount,
  workflowRunCount = 1,
}: RenderWorkspaceOptions = {}) {
  const backend = createProjectAssetsBackend({ characterCount, projectCount })
  const failedOnce = new Set<string>()
  let deferredFirstRequest = false
  let releaseDeferred: () => void = () => undefined
  const deferredRequest = new Promise<void>((resolve) => {
    releaseDeferred = resolve
  })
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const failureKind =
      url.pathname === '/projects'
        ? 'projects'
        : url.pathname === '/workflow-runs'
          ? 'workflows'
          : url.pathname === '/characters'
            ? 'characters'
            : null
    if (
      failureKind !== null &&
      (fail === failureKind || (failOnce === failureKind && !failedOnce.has(failureKind)))
    ) {
      failedOnce.add(failureKind)
      throw new TypeError('network unavailable')
    }
    if (
      failureKind !== null &&
      (defer === failureKind || (deferFirst === failureKind && !deferredFirstRequest))
    ) {
      deferredFirstRequest = true
      await deferredRequest
    }
    if (request.method === 'GET' && url.pathname === '/workflow-runs') {
      const page = Number(url.searchParams.get('page') ?? 1)
      const pageSize = Number(url.searchParams.get('page_size') ?? 4)
      const projectId = Number(url.searchParams.get('project_id') ?? 42)
      const start = (page - 1) * pageSize
      const runs = Array.from({ length: workflowRunCount }, (_, index) => ({
        id: (projectId === 99 ? 599 : 501) + index,
        project_id: projectId,
        status: 'active',
        version: 2,
        nodes: [
          {
            id: 'character-setup',
            type: 'character-setup',
            status: 'passed',
            phase: 'completed',
            dependsOnNodeIds: [],
            generations: [],
            error: null,
            input: {
              name:
                index === 0
                  ? projectId === 99
                    ? '海岸守望者'
                    : '轻装信使'
                  : `工作流角色 ${index + 1}`,
              characterId: String(51 + index),
              prompt: '轻装信使',
              referenceMedia: [],
            },
          },
          {
            id: 'character-template',
            type: 'character-template',
            status: 'active',
            phase: 'generating',
            dependsOnNodeIds: ['character-setup'],
            generations: [{ taskId: `task-${index + 1}`, role: 'character_template' }],
            error: null,
            selectedImageUrl: null,
          },
        ],
      }))
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: runs.slice(start, start + pageSize),
          total: runs.length,
          page,
          page_size: pageSize,
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    const backendResponse = await backend.fetch(request)
    if (request.method === 'GET' && url.pathname === '/characters' && outfitCount !== undefined) {
      const envelope = (await backendResponse.json()) as {
        code: number
        data: Array<{
          character_data: {
            outfits: Array<{
              actions: unknown[]
              description: string | null
              id: string
              name: string
              preview_url: string | null
            }>
          }
        }>
        message: string
        page: number
        page_size: number
        total: number
      }
      const character = envelope.data[0]
      const baseOutfit = character?.character_data.outfits[0]
      if (character && baseOutfit) {
        character.character_data.outfits = Array.from({ length: outfitCount }, (_, index) => ({
          ...structuredClone(baseOutfit),
          id: `outfit-${index + 1}`,
          name: `常态造型 ${index + 1}`,
        }))
      }
      return new Response(JSON.stringify(envelope), {
        headers: { 'content-type': 'application/json' },
      })
    }
    return backendResponse
  }
  vi.stubGlobal('fetch', fetch)

  return {
    backend,
    releaseDeferred,
    ...render(
      <MemoryRouter initialEntries={['/workspace']}>
        <WorkspacePage />
      </MemoryRouter>,
    ),
  }
}

describe('WorkspacePage', () => {
  it('uses a fixed editorial canvas without nested card chrome', () => {
    const { container } = renderWorkspace()

    const page = container.querySelector('.workspace-page')
    expect(page?.className).toContain('h-svh')
    expect(page?.className).toContain('overflow-hidden')
    expect(screen.queryByText('Production desk', { exact: true })).toBeNull()
    expect(screen.queryByText('Context toolbox', { exact: true })).toBeNull()
    expect(screen.getByRole('heading', { name: '最近项目' })).toBeTruthy()

    const entrance = screen.getByRole('link', { name: '进入快速开始' })
    expect(entrance.className).not.toContain('rounded')
    expect(entrance.className).not.toContain('shadow')
    expect(entrance.className).not.toContain('border')

    const context = screen.getByRole('heading', { name: '最近项目' }).closest('aside')
    expect(context?.className).not.toContain('rounded')
    expect(context?.className).not.toContain('shadow')
  })

  it('keeps the four entrances usable on narrow screens', () => {
    const { container } = renderWorkspace()

    expect(container.querySelector('.workspace-layout')?.className).toContain('grid-cols-1')
    expect(screen.getByRole('complementary').className).toContain('max-md:hidden')
  })

  it('does not claim projects are sorted by update time', async () => {
    renderWorkspace()

    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })
    expect(screen.queryByText('按更新时间')).toBeNull()
    expect(screen.getByText('项目列表')).toBeTruthy()
  })

  it('omits entrance badges and decorative context-header chrome', () => {
    const { container } = renderWorkspace()

    expect(screen.queryAllByText('直接进入', { exact: true })).toHaveLength(0)
    expect(screen.queryAllByText('选择上下文', { exact: true })).toHaveLength(0)

    const contextTitle = screen.getByRole('heading', { name: '最近项目' })
    expect(contextTitle.parentElement?.previousElementSibling).toBeNull()
    expect(contextTitle.closest('header')?.querySelector(':scope > div > span')).toBeNull()
    expect(container.querySelectorAll('.workspace-entrance-card')).toHaveLength(4)
  })

  it('keeps artwork and copy on one uninterrupted card surface', () => {
    const { container } = renderWorkspace()

    const artworkSurface = container.querySelector('.workspace-artwork-stage')?.parentElement
    expect(artworkSurface?.className).not.toContain('border-b')
  })

  it('keeps direct tasks navigable and loads real projects in the context toolbox', async () => {
    renderWorkspace()

    expect(screen.getByRole('heading', { name: '工作台' })).toBeTruthy()
    expect(screen.getByText('从这里开始，去任何地方')).toBeTruthy()
    expect(screen.getByRole('link', { name: '进入快速开始' }).getAttribute('href')).toBe(
      '/quick-start',
    )
    expect(screen.getByRole('link', { name: '创建新项目' }).getAttribute('href')).toBe(
      '/projects/new?entry=workflow-editor',
    )
    expect(screen.getByRole('button', { name: '继续已有工作流' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '进入资产库' }).getAttribute('href')).toBe('/projects')
    expect(screen.getByRole('button', { name: '选择预览台' })).toBeTruthy()

    expect(await screen.findByRole('heading', { name: '最近项目' })).toBeTruthy()
    expect(
      (await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })).getAttribute('href'),
    ).toBe('/projects/42/assets')
    expect(screen.getByText('08/04 更新')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看全部项目' }).getAttribute('href')).toBe(
      '/projects',
    )
    expect(screen.getByRole('link', { name: '新建项目' }).getAttribute('href')).toBe(
      '/projects/new',
    )
  })

  it('announces project loading before the first page resolves', async () => {
    const { releaseDeferred } = renderWorkspace({ defer: 'projects' })

    expect(screen.getByRole('status').textContent).toContain('正在读取项目')
    releaseDeferred()
    expect(await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })).toBeTruthy()
  })

  it('requires a real project and WorkflowRun before opening the canvas', async () => {
    renderWorkspace()
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '继续已有工作流' }))

    expect(screen.getByRole('heading', { name: '选择工作流' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /打开工作流/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))

    expect(
      (await screen.findByRole('link', { name: '打开工作流 轻装信使' })).getAttribute('href'),
    ).toBe('/workflow-editor/501')
    expect(screen.getByText('WorkflowRun #501')).toBeTruthy()
    expect(screen.getByText('1 / 2 节点完成')).toBeTruthy()
  })

  it('announces WorkflowRun loading for the selected project', async () => {
    const { releaseDeferred } = renderWorkspace({ defer: 'workflows' })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '继续已有工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    expect(screen.getByRole('status').textContent).toContain('正在读取工作流')
    releaseDeferred()
    expect(await screen.findByRole('link', { name: '打开工作流 轻装信使' })).toBeTruthy()
  })

  it('opens Playtest only after choosing a character outfit with real frames', async () => {
    renderWorkspace()
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))

    expect(screen.getByRole('heading', { name: '选择可预览造型' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^预览 / })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择角色 轻装信使' }))

    expect(
      (await screen.findByRole('link', { name: '预览 轻装信使 · 常态造型' })).getAttribute('href'),
    ).toBe('/playtest/51/outfit-default')
    expect(screen.getByText('2 个动作 · 5 帧')).toBeTruthy()
  })

  it('announces character loading for the selected project', async () => {
    const { releaseDeferred } = renderWorkspace({ defer: 'characters' })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    expect(screen.getByRole('status').textContent).toContain('正在读取角色')
    releaseDeferred()
    expect(await screen.findByRole('button', { name: '选择角色 轻装信使' })).toBeTruthy()
  })

  it('ignores a stale WorkflowRun response after the user changes projects', async () => {
    const { releaseDeferred } = renderWorkspace({ deferFirst: 'workflows' })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '继续已有工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    expect(screen.getByRole('status').textContent).toContain('正在读取工作流')
    fireEvent.click(screen.getByRole('button', { name: '重新选择项目' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 空白海岸' }))
    expect(await screen.findByRole('link', { name: '打开工作流 海岸守望者' })).toBeTruthy()

    releaseDeferred()
    expect(screen.queryByRole('link', { name: '打开工作流 轻装信使' })).toBeNull()
    expect(screen.getByText('海岸守望者')).toBeTruthy()
  })

  it('keeps a failed project request distinct from an empty account', async () => {
    renderWorkspace({ fail: 'projects' })

    expect((await screen.findByRole('alert')).textContent).toContain('项目暂时无法读取')
    expect(screen.queryByText('还没有项目')).toBeNull()
  })

  it('retries a failed project request without confusing it with an empty account', async () => {
    renderWorkspace({ failOnce: 'projects' })

    expect((await screen.findByRole('alert')).textContent).toContain('项目暂时无法读取')
    fireEvent.click(screen.getByRole('button', { name: '重试读取项目' }))

    expect(await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })).toBeTruthy()
  })

  it('directs an empty account to create its first project', async () => {
    renderWorkspace({ projectCount: 0 })

    expect(await screen.findByText('还没有项目')).toBeTruthy()
    expect(screen.getByRole('link', { name: '新建项目' }).getAttribute('href')).toBe(
      '/projects/new',
    )
    expect(screen.getByRole('link', { name: '从快速开始创建' }).getAttribute('href')).toBe(
      '/quick-start',
    )
  })

  it('does not invent an empty WorkflowRun when a project has none', async () => {
    renderWorkspace({ workflowRunCount: 0 })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '继续已有工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))

    expect(await screen.findByText('这个项目还没有工作流')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /打开工作流/ })).toBeNull()
    expect(screen.getByRole('link', { name: '通过快速开始建立流程' }).getAttribute('href')).toBe(
      '/quick-start',
    )
  })

  it('keeps a WorkflowRun request failure distinct from an empty project', async () => {
    renderWorkspace({ fail: 'workflows' })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '继续已有工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))

    expect((await screen.findByRole('alert')).textContent).toContain('工作流暂时无法读取')
    expect(screen.queryByText('这个项目还没有工作流')).toBeNull()
  })

  it('retries WorkflowRuns for the selected project', async () => {
    renderWorkspace({ failOnce: 'workflows' })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '继续已有工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    expect((await screen.findByRole('alert')).textContent).toContain('工作流暂时无法读取')
    fireEvent.click(screen.getByRole('button', { name: '重试读取工作流' }))

    expect(await screen.findByRole('link', { name: '打开工作流 轻装信使' })).toBeTruthy()
  })

  it('explains when a project has no characters to test', async () => {
    renderWorkspace({ characterCount: 0 })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))

    expect(await screen.findByText('这个项目还没有角色')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看当前项目资产' }).getAttribute('href')).toBe(
      '/projects/42/assets',
    )
  })

  it('keeps a character request failure distinct from an empty project', async () => {
    renderWorkspace({ fail: 'characters' })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))

    expect((await screen.findByRole('alert')).textContent).toContain('角色资产暂时无法读取')
    expect(screen.queryByText('这个项目还没有角色')).toBeNull()
  })

  it('retries characters for the selected project', async () => {
    renderWorkspace({ failOnce: 'characters' })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    expect((await screen.findByRole('alert')).textContent).toContain('角色资产暂时无法读取')
    fireEvent.click(screen.getByRole('button', { name: '重试读取角色' }))

    expect(await screen.findByRole('button', { name: '选择角色 轻装信使' })).toBeTruthy()
  })

  it('explains when a character has no outfits and keeps project assets reachable', async () => {
    renderWorkspace({ outfitCount: 0 })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择角色 轻装信使' }))

    expect(await screen.findByText('这个角色还没有造型')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看当前项目资产' }).getAttribute('href')).toBe(
      '/projects/42/assets',
    )
  })

  it('keeps an outfit without frames visible but not playable', async () => {
    renderWorkspace()
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择角色 待定角色' }))

    expect(await screen.findByText('尚无可播放帧')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /预览 待定角色/ })).toBeNull()
    expect(screen.getByRole('link', { name: '查看当前项目资产' }).getAttribute('href')).toBe(
      '/projects/42/assets',
    )
    expect(screen.getByRole('link', { name: '查看全部可预览资产' }).getAttribute('href')).toBe(
      '/playtest',
    )
  })

  it('supports returning through project and character selection levels', async () => {
    renderWorkspace()
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择角色 轻装信使' }))
    await screen.findByRole('link', { name: '预览 轻装信使 · 常态造型' })

    fireEvent.click(screen.getByRole('button', { name: '重新选择角色' }))
    expect(await screen.findByRole('button', { name: '选择角色 轻装信使' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新选择项目' }))
    expect(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' })).toBeTruthy()
  })

  it('pages through project choices instead of silently omitting later projects', async () => {
    renderWorkspace({ projectCount: 5 })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '继续已有工作流' }))

    expect(screen.queryByRole('button', { name: '选择项目 分页项目 5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByRole('button', { name: '选择项目 分页项目 5' })).toBeTruthy()
  })

  it('pages through WorkflowRuns within the selected project', async () => {
    renderWorkspace({ workflowRunCount: 5 })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '继续已有工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    await screen.findByRole('link', { name: '打开工作流 轻装信使' })

    expect(screen.queryByRole('link', { name: '打开工作流 工作流角色 5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(
      (await screen.findByRole('link', { name: '打开工作流 工作流角色 5' })).getAttribute('href'),
    ).toBe('/workflow-editor/505')
  })

  it('pages through characters within the selected project', async () => {
    renderWorkspace({ characterCount: 5 })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    await screen.findByRole('button', { name: '选择角色 轻装信使' })

    expect(screen.queryByRole('button', { name: '选择角色 分页角色 5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByRole('button', { name: '选择角色 分页角色 5' })).toBeTruthy()
  })

  it('pages through outfits within the selected character', async () => {
    renderWorkspace({ outfitCount: 5 })
    await screen.findByRole('link', { name: '打开项目 点灯人 · MVP' })

    fireEvent.click(screen.getByRole('button', { name: '选择预览台' }))
    fireEvent.click(screen.getByRole('button', { name: '选择项目 点灯人 · MVP' }))
    fireEvent.click(await screen.findByRole('button', { name: '选择角色 轻装信使' }))

    expect(screen.queryByRole('link', { name: '预览 轻装信使 · 常态造型 5' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(
      (await screen.findByRole('link', { name: '预览 轻装信使 · 常态造型 5' })).getAttribute(
        'href',
      ),
    ).toBe('/playtest/51/outfit-5')
  })
})
