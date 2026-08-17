// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '@/app'
import { AuthenticatedAuthSession } from '@/test/auth-session'
import { createProjectAssetsBackend } from '@/test/project-assets-backend'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/**
 * 停掉动画循环，让断言只看某一次输入之后的静止状态。
 * 逐帧推进本身由 runtime 的纯函数测试覆盖，不靠页面测试的时序碰运气。
 */
function freezeAnimationFrame() {
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
}

function renderPlaytest(path: string, fetchFn?: typeof globalThis.fetch) {
  freezeAnimationFrame()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', fetchFn ?? createProjectAssetsBackend().fetch)
  return render(
    <AuthenticatedAuthSession>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthenticatedAuthSession>,
  )
}

function stageFrameUrl() {
  return screen.getByRole('region', { name: '预览舞台' }).querySelector('img')?.getAttribute('src')
}

describe('PlaytestPage', () => {
  it('loads the routed character through the Character API', async () => {
    renderPlaytest('/playtest/51/outfit-default')

    expect(await screen.findByRole('heading', { name: '51 · 常态造型' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '绑定动作：呼吸待机' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '绑定动作：行走' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出Playtest 运行包' })).toBeTruthy()
  })

  it('plays frames in backend index order, not array order', async () => {
    renderPlaytest('/playtest/51/outfit-default')

    expect(await screen.findByRole('heading', { name: '51 · 常态造型' })).toBeTruthy()
    const walkButton = await screen.findByRole('button', { name: '绑定动作：行走' })
    // 后端给的 walk 帧顺序是 index 2、0、1；照数组播会从 walk-03 起步。
    fireEvent.click(walkButton)

    // 先等绑定态（aria-pressed），再读舞台帧。覆盖率下 waitFor 默认 1s 会把重试耗在整页 HTML 上，
    // 点了行走却仍断言到 idle-01，Frontend CI 就会红。
    await waitFor(
      () => {
        expect(walkButton.getAttribute('aria-pressed')).toBe('true')
        expect(stageFrameUrl()).toBe('https://cdn.windup.test/walk-01.png')
      },
      { timeout: 4000 },
    )
  })

  it('starts on the idle action when the route names none', async () => {
    renderPlaytest('/playtest/51/outfit-default')

    expect(await screen.findByRole('heading', { name: '51 · 常态造型' })).toBeTruthy()
    expect(stageFrameUrl()).toBe('https://cdn.windup.test/idle-01.png')
  })

  it('opens on the action named by the route query', async () => {
    renderPlaytest('/playtest/51/outfit-default?actionId=walk')

    expect(await screen.findByRole('heading', { name: '51 · 常态造型' })).toBeTruthy()
    expect(stageFrameUrl()).toBe('https://cdn.windup.test/walk-01.png')
  })

  it('reports a missing outfit instead of falling back to another one', async () => {
    renderPlaytest('/playtest/51/outfit-missing')

    expect(await screen.findByText('找不到指定造型，无法进入预览台。')).toBeTruthy()
  })

  it('maps the business not-found code to a stable message', async () => {
    renderPlaytest('/playtest/9999/outfit-default')

    expect(await screen.findByText('角色不存在')).toBeTruthy()
  })

  it('does not mislabel a transport failure as not found', async () => {
    renderPlaytest('/playtest/51/outfit-default', () =>
      Promise.reject(new TypeError('network unavailable')),
    )

    expect(await screen.findByText('角色读取失败')).toBeTruthy()
  })

  it('shows an empty stage for an outfit whose actions have no frames', async () => {
    renderPlaytest('/playtest/52/outfit-draft')

    expect(await screen.findByRole('heading', { name: '52 · 未命名造型' })).toBeTruthy()
    expect(screen.getByText('暂无可播放帧')).toBeTruthy()
  })

  it('旧资产缺少角色母版时仍可试玩，但不显示无效导出入口', async () => {
    const backend = createProjectAssetsBackend()
    const fetchWithoutMaster: typeof globalThis.fetch = async (input, init) => {
      const response = await backend.fetch(input, init)
      if (new URL(new Request(input, init).url).pathname !== '/characters/51') return response
      const body = (await response.json()) as {
        data: {
          reference_image_url: string | null
          character_data: { outfits: Array<{ preview_url: string | null }> }
        }
      }
      body.data.reference_image_url = null
      body.data.character_data.outfits[0]!.preview_url = null
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    }

    renderPlaytest('/playtest/51/outfit-default', fetchWithoutMaster)

    expect(await screen.findByRole('heading', { name: '51 · 常态造型' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '导出Playtest 运行包' })).toBeNull()
  })
})
