// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import expectedBirdLeft from '@/assets/landing/illustrations/gongbi-tit-flight-up.webp'
import expectedBirdRight from '@/assets/landing/illustrations/gongbi-tit-flight-down.webp'
import { AuthenticatedAuthSession, GuestAuthSession } from '@/test/auth-session'
import { LandingPage } from './index'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('LandingPage', () => {
  it('用居中宣言、两只工笔鸟与留白产品窗组成首屏', async () => {
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
    expect(birdLeft.getAttribute('src')).toBe(expectedBirdLeft)
    expect(birdRight.getAttribute('src')).toBe(expectedBirdRight)
    for (const image of [birdLeft, birdRight]) {
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
    expect(screen.queryByRole('navigation', { name: '宣传页导航' })).toBeNull()
    expect(screen.queryByText('产品能力')).toBeNull()
    expect(screen.queryByText('制作流程')).toBeNull()
    const globalHeader = document.querySelector('header[data-layout="unified"]')
    expect(globalHeader?.getAttribute('data-layout')).toBe('unified')
    expect(globalHeader?.getAttribute('data-surface')).toBe('borderless-glass')
    expect(globalHeader?.firstElementChild?.className).toContain('min-h-18')
    expect(globalHeader?.className).toContain('fixed')
    expect(globalHeader?.className).toContain('backdrop-blur-[18px]')
    expect(globalHeader?.className).toContain('backdrop-saturate-[0.82]')
    expect(globalHeader?.className).not.toContain('border')
    expect(screen.getByRole('link', { name: '登录' }).getAttribute('href')).toBe(
      '/?account=login&returnTo=%2Fworkspace',
    )
    expect(screen.getByRole('link', { name: '注册' }).getAttribute('href')).toBe(
      '/?account=register&returnTo=%2Fworkspace',
    )
    expect(screen.queryByRole('button', { name: '注册' })).toBeNull()
    expect(screen.queryByText('内测暂不开放，联系团队申请')).toBeNull()
    // Header 只处理账号入口，Hero 与收尾负责把用户带进创作。
    const creationLinks = screen.getAllByRole('link', { name: '开始创作' })
    expect(creationLinks).toHaveLength(2)
    for (const link of creationLinks) {
      expect(link.getAttribute('href')).toBe('/?account=login&returnTo=%2Fworkspace')
    }
    expect(screen.getByText('从角色设定到可玩的 2D 动作资产')).toBeTruthy()
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

  it('移除 Workflow Editor 图片，但保留三个白色占位容器', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    expect(await screen.findAllByTestId('workflow-editor-placeholder')).toHaveLength(3)
    expect(document.querySelector('img[src*="workflow-editor"]')).toBeNull()
    expect(document.querySelector('source[srcset*="workflow-editor"]')).toBeNull()
  })

  it('在收尾插画之后提供真实的开源项目入口', async () => {
    render(
      <GuestAuthSession>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </GuestAuthSession>,
    )

    const footer = await screen.findByRole('contentinfo')
    const header = document.querySelector<HTMLElement>('header[data-layout="unified"]')

    expect(header).not.toBeNull()
    expect(within(header!).getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe(
      'https://github.com/1024XEngineer/Windup',
    )
    expect(within(footer).getByText('Windup 是一个开源的 2D 角色资产工作台。')).toBeTruthy()
    expect(within(footer).getByRole('link', { name: 'GitHub 仓库' }).getAttribute('href')).toBe(
      'https://github.com/1024XEngineer/Windup',
    )
    expect(within(footer).getByRole('link', { name: 'Issues' }).getAttribute('href')).toBe(
      'https://github.com/1024XEngineer/Windup/issues',
    )
    expect(within(footer).getByRole('link', { name: 'Contributors' }).getAttribute('href')).toBe(
      'https://github.com/1024XEngineer/Windup/graphs/contributors',
    )
    expect(within(footer).queryByText(/隐私政策|服务条款|备案/)).toBeNull()
  })
})
