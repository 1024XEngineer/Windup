// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import expectedBirdLeft from '@/assets/landing/illustrations/gongbi-tit-flight-up.webp'
import expectedBirdRight from '@/assets/landing/illustrations/gongbi-tit-flight-down.webp'
import expectedWorkflowEditorDesktop from '@/assets/landing/screenshots/workflow-editor-runtime-desktop.jpg'
import { AuthenticatedAuthSession, GuestAuthSession } from '@/test/auth-session'
import { LandingPage } from './index'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('LandingPage', () => {
  it('用居中宣言、两只工笔鸟与真实编辑器组成首屏', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    const hero = await screen.findByRole('region', { name: 'Windup 首屏' })

    expect(within(hero).getByRole('heading', { name: '让你的角色，真正登场。' })).toBeTruthy()
    const birdLeft = within(hero).getByTestId('hero-bird-left')
    const birdRight = within(hero).getByTestId('hero-bird-right')
    const editor = within(hero).getByRole('img', {
      name: 'Windup Workflow Editor 真实运行界面',
    })
    expect(birdLeft.getAttribute('src')).toBe(expectedBirdLeft)
    expect(birdRight.getAttribute('src')).toBe(expectedBirdRight)
    for (const image of [birdLeft, birdRight, editor]) {
      expect(image.getAttribute('loading')).toBe('eager')
      expect(image.getAttribute('decoding')).toBe('async')
      expect(image.getAttribute('fetchpriority')).toBe('high')
    }
    expect(within(hero).queryByTestId('landing-brand-bird')).toBeNull()
  })

  it('让访客先理解产品，再通过明确的登录与创作入口进入产品', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    expect(await screen.findByRole('heading', { name: '让你的角色，真正登场。' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '宣传页导航' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '登录' }).getAttribute('href')).toBe(
      '/?account=login&returnTo=%2Fworkspace',
    )
    expect((screen.getByRole('button', { name: '注册' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('link', { name: '注册' })).toBeNull()
    expect(
      screen.getByRole('link', { name: '内测暂不开放，联系团队申请' }).getAttribute('href'),
    ).toBe('https://github.com/1024XEngineer/Windup/issues')
    // 重新开放注册时恢复：
    // expect(screen.getByRole('link', { name: '注册' }).getAttribute('href')).toBe(
    //   '/?account=register&returnTo=%2Fworkspace',
    // )
    // Header 只处理账号入口，Hero 与收尾负责把用户带进创作。
    const creationLinks = screen.getAllByRole('link', { name: '开始创作' })
    expect(creationLinks).toHaveLength(2)
    for (const link of creationLinks) {
      expect(link.getAttribute('href')).toBe('/?account=login&returnTo=%2Fworkspace')
    }
    const sectionLinks = [
      ['产品能力', '#capabilities'],
      ['制作流程', '#workflow'],
      ['资产工作台', '#workspace'],
    ] as const
    for (const [name, href] of sectionLinks) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(href)
      expect(document.querySelector(href)).not.toBeNull()
    }
    expect(screen.getByRole('heading', { name: '角色做出来，还要留下来、跑起来。' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '同一份创作，两种进入方式。' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '资产会留下来，继续生长。' })).toBeTruthy()
  })

  it('让已登录用户留在宣传页，主动点击入口后再进入工作台', async () => {
    render(
      <AuthenticatedAuthSession>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </AuthenticatedAuthSession>,
    )

    expect((await screen.findByRole('link', { name: '进入工作台' })).getAttribute('href')).toBe(
      '/workspace',
    )
    const creationLinks = screen.getAllByRole('link', { name: '开始创作' })
    expect(creationLinks).toHaveLength(2)
    for (const link of creationLinks) {
      expect(link.getAttribute('href')).toBe('/workspace')
    }
    expect(screen.queryByRole('link', { name: '登录' })).toBeNull()
  })

  it('所有宣传页产品窗只使用真实桌面截图，不附带未维护的移动端变体', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    const screenshots = await screen.findAllByRole('img', {
      name: 'Windup Workflow Editor 真实运行界面',
    })
    expect(screenshots).toHaveLength(2)
    for (const screenshot of screenshots) {
      expect(screenshot.getAttribute('src')).toBe(expectedWorkflowEditorDesktop)
    }
    expect(document.querySelector('source[srcset*="workflow-editor"]')).toBeNull()
  })
})
