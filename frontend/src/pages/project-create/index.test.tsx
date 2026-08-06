// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '@/app'
import { registerCurrentUserIdProvider } from '@/shared/api'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

const revokeProviders: Array<() => void> = []

afterEach(() => {
  cleanup()
  while (revokeProviders.length) revokeProviders.pop()?.()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function installBackend() {
  const backend = createProjectAssetsBackend()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', backend.fetch)
  return backend
}

/** 登录模块尚未落地，测试里用同一个 provider 边界冒充已登录用户。 */
function signIn(ownerId = '7') {
  revokeProviders.push(registerCurrentUserIdProvider(() => ownerId))
}

function renderProjectCreate() {
  return render(
    <MemoryRouter initialEntries={['/projects/new']}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

function creationRequests(backend: ReturnType<typeof createProjectAssetsBackend>) {
  return backend.requests.filter(
    (request) => request.method === 'POST' && new URL(request.url).pathname === '/projects',
  )
}

describe('ProjectCreatePage', () => {
  it('按项目契约提交表单并进入创建出的项目', async () => {
    const backend = installBackend()
    signIn()
    renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })
    fireEvent.change(screen.getByLabelText('游戏视角'), { target: { value: 'top-down' } })
    fireEvent.change(screen.getByLabelText('朝向'), { target: { value: 'eight-way' } })
    fireEvent.click(screen.getByRole('button', { name: '512 × 512' }))
    fireEvent.change(screen.getByLabelText('画风约束'), { target: { value: '低饱和像素绘本' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByRole('heading', { name: '角色' })).toBeTruthy()
    const [request] = creationRequests(backend)
    expect(await request.json()).toMatchObject({
      user_id: 7,
      project_name: '雾港来信',
      character_perspective: 2,
      directional_movement: 3,
      sprite_width: 512,
      sprite_height: 512,
      game_style: '低饱和像素绘本',
    })
  })

  it('没有当前用户来源时禁用创建并说明原因', async () => {
    const backend = installBackend()
    renderProjectCreate()

    const submit = await screen.findByRole('button', { name: '创建项目' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/登录/)).toBeTruthy()
    expect(creationRequests(backend)).toHaveLength(0)
  })

  it('名称超过 20 字时在提交前拦下', async () => {
    const backend = installBackend()
    signIn()
    renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾'.repeat(21) } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect(await screen.findByText('项目名称最多 20 个字')).toBeTruthy()
    expect(creationRequests(backend)).toHaveLength(0)
  })

  it('名称重复时保留已填内容并显示后端给出的原因', async () => {
    installBackend()
    signIn()
    renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '点灯人 · MVP' } })
    fireEvent.change(screen.getByLabelText('画风约束'), { target: { value: '低饱和像素绘本' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect((await screen.findByRole('alert')).textContent).toBe('项目名称已存在')
    expect((screen.getByLabelText('画风约束') as HTMLTextAreaElement).value).toBe('低饱和像素绘本')
  })

  it('连续点击创建只发出一次请求', async () => {
    const backend = installBackend()
    signIn()
    renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })
    const submit = screen.getByRole('button', { name: '创建项目' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    await waitFor(() => expect(creationRequests(backend).length).toBeGreaterThan(0))
    expect(creationRequests(backend)).toHaveLength(1)
  })
  it('名称留空时在提交前拦下', async () => {
    const backend = installBackend()
    signIn()
    renderProjectCreate()

    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect((await screen.findByRole('alert')).textContent).toBe('请填写项目名称')
    expect(creationRequests(backend)).toHaveLength(0)
  })

  it('精灵宽高越界时在提交前拦下', async () => {
    const backend = installBackend()
    signIn()
    renderProjectCreate()

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
    signIn()
    renderProjectCreate()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))

    expect((await screen.findByRole('alert')).textContent).toBe('项目暂时无法创建')
  })

  it('改动任一字段后撤掉上一次的错误', async () => {
    installBackend()
    signIn()
    renderProjectCreate()

    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '雾港来信' } })

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
