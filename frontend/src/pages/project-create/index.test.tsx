// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'

import { AppRoutes } from '@/app'
import { ProjectCreatePage } from '@/pages/project-create'
import { AuthenticatedAuthSession, GuestAuthSession } from '@/test/auth-session'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function installBackend() {
  const backend = createProjectAssetsBackend()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', backend.fetch)
  return backend
}

async function renderProjectCreate(authenticated = true) {
  const Session = authenticated ? AuthenticatedAuthSession : GuestAuthSession
  const result = render(
    <Session>
      <MemoryRouter initialEntries={['/projects/new']}>
        <AppRoutes />
      </MemoryRouter>
    </Session>,
  )
  if (authenticated) await screen.findByText('Reader')
  return result
}

function creationRequests(backend: ReturnType<typeof createProjectAssetsBackend>) {
  return backend.requests.filter(
    (request) => request.method === 'POST' && new URL(request.url).pathname === '/projects',
  )
}

function workflowCreationRequests(backend: ReturnType<typeof createProjectAssetsBackend>) {
  return backend.requests.filter(
    (request) => request.method === 'POST' && new URL(request.url).pathname === '/workflow-runs',
  )
}

function installWorkflowBackend(failWorkflowAttempts = 0) {
  const backend = createProjectAssetsBackend()
  const baseFetch = backend.fetch
  let remainingFailures = failWorkflowAttempts
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/workflow-runs') {
      return baseFetch(input, init)
    }

    backend.requests.push(request.clone())
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return new Response(
        JSON.stringify({ code: 500, message: '工作流暂时无法创建', data: null }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    const body = (await request.json()) as { project_id: number; nodes: unknown[] }
    return new Response(
      JSON.stringify({
        code: 200,
        message: 'success',
        data: {
          id: 701,
          project_id: body.project_id,
          nodes: body.nodes,
          status: 'active',
          version: 1,
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  }
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', fetch)
  return backend
}

function WorkflowDestination() {
  const { runId } = useParams()
  return <h1>Workflow Editor {runId}</h1>
}

async function renderWorkflowProjectCreate() {
  const result = render(
    <AuthenticatedAuthSession>
      <MemoryRouter initialEntries={['/projects/new?entry=workflow-editor']}>
        <Routes>
          <Route path="/projects/new" element={<ProjectCreatePage />} />
          <Route path="/workflow-editor/:runId" element={<WorkflowDestination />} />
        </Routes>
      </MemoryRouter>
    </AuthenticatedAuthSession>,
  )
  await screen.findByRole('button', { name: '创建项目' })
  return result
}

describe('ProjectCreatePage', () => {
  it('从工作流入口创建项目后创建正式 WorkflowRun 并进入画布', async () => {
    const backend = installWorkflowBackend()
    await renderWorkflowProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港画布' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByRole('heading', { name: 'Workflow Editor 701' })).toBeTruthy()
    expect(creationRequests(backend)).toHaveLength(1)
    const [workflowRequest] = workflowCreationRequests(backend)
    expect(workflowRequest).toBeTruthy()
    expect(await workflowRequest!.json()).toMatchObject({
      project_id: 4242,
      nodes: [
        {
          id: 'character-setup',
          type: 'character-setup',
          status: 'active',
          phase: 'configuring',
          dependsOnNodeIds: [],
          input: { prompt: '', referenceMedia: [] },
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'locked',
          phase: 'ready',
          dependsOnNodeIds: ['character-setup'],
        },
      ],
    })
  })

  it('WorkflowRun 创建失败后只重试工作流，不重复创建项目', async () => {
    const backend = installWorkflowBackend(1)
    await renderWorkflowProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '可重试画布' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      '项目已创建，但工作流暂时无法创建',
    )
    expect(creationRequests(backend)).toHaveLength(1)
    expect(workflowCreationRequests(backend)).toHaveLength(1)

    const projectName = screen.getByLabelText('项目名称') as HTMLInputElement
    const spriteWidth = screen.getByLabelText('宽度（像素）') as HTMLInputElement
    expect(projectName.disabled).toBe(true)
    expect(spriteWidth.disabled).toBe(true)
    fireEvent.change(projectName, { target: { value: '' } })
    fireEvent.change(spriteWidth, { target: { value: '16' } })
    fireEvent.click(screen.getByRole('button', { name: '重试进入工作流' }))

    expect(await screen.findByRole('heading', { name: 'Workflow Editor 701' })).toBeTruthy()
    expect(creationRequests(backend)).toHaveLength(1)
    expect(workflowCreationRequests(backend)).toHaveLength(2)
  })

  it('按项目契约提交表单并进入创建出的项目', async () => {
    const backend = installBackend()
    await renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })
    fireEvent.change(screen.getByLabelText('游戏视角'), { target: { value: 'top-down' } })
    fireEvent.change(screen.getByLabelText('朝向'), { target: { value: 'eight-way' } })
    fireEvent.click(screen.getByRole('button', { name: '512 × 512' }))
    fireEvent.change(screen.getByLabelText('画风约束'), { target: { value: '低饱和像素绘本' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByRole('heading', { name: '角色' })).toBeTruthy()
    const [request] = creationRequests(backend)
    expect(request.headers.get('authorization')).toBe('Bearer access-token-for-test')
    const body = (await request.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      project_name: '雾港来信',
      character_perspective: 2,
      directional_movement: 3,
      sprite_width: 512,
      sprite_height: 512,
      game_style: '低饱和像素绘本',
    })
    // 归属由后端从 JWT 取；请求体再带 user_id 就等于宣称可以替别人建项目。
    expect(Object.hasOwn(body, 'user_id')).toBe(false)
  })

  it('没有登录凭证时先进入登录面板，不挂载创建页面', async () => {
    const backend = installBackend()
    await renderProjectCreate(false)

    expect(await screen.findByRole('dialog', { name: '登录 Windup' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '创建项目' })).toBeNull()
    expect(creationRequests(backend)).toHaveLength(0)
  })

  it('名称超过 20 字时在提交前拦下', async () => {
    const backend = installBackend()
    await renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾'.repeat(21) } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByText('项目名称最多 20 个字')).toBeTruthy()
    expect(creationRequests(backend)).toHaveLength(0)
  })

  it('名称重复时保留已填内容并显示后端给出的原因', async () => {
    installBackend()
    await renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '点灯人 · MVP' } })
    fireEvent.change(screen.getByLabelText('画风约束'), { target: { value: '低饱和像素绘本' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect((await screen.findByRole('alert')).textContent).toBe('项目名称已存在')
    expect((screen.getByLabelText('画风约束') as HTMLTextAreaElement).value).toBe('低饱和像素绘本')
  })

  it('连续点击创建只发出一次请求', async () => {
    const backend = installBackend()
    await renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })
    const submit = screen.getByRole('button', { name: '创建项目' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    await waitFor(() => expect(creationRequests(backend).length).toBeGreaterThan(0))
    expect(creationRequests(backend)).toHaveLength(1)
  })
  it('名称留空时在提交前拦下', async () => {
    const backend = installBackend()
    await renderProjectCreate()

    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect((await screen.findByRole('alert')).textContent).toBe('请填写项目名称')
    expect(creationRequests(backend)).toHaveLength(0)
  })

  it('精灵宽高越界时在提交前拦下', async () => {
    const backend = installBackend()
    await renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })
    fireEvent.change(screen.getByLabelText('宽度（像素）'), { target: { value: '16' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      '精灵宽高需要是 32 到 2048 之间的整数',
    )
    expect(creationRequests(backend)).toHaveLength(0)
  })

  it('传输失败时收敛成一句统一文案', async () => {
    installBackend()
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
    await renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect((await screen.findByRole('alert')).textContent).toBe('项目暂时无法创建')
  })

  it('改动任一字段后撤掉上一次的错误', async () => {
    installBackend()
    await renderProjectCreate()

    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })

    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('点尺寸预设后撤掉上一次的错误', async () => {
    installBackend()
    await renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })
    fireEvent.change(screen.getByLabelText('宽度（像素）'), { target: { value: '16' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '256 × 256' }))

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
