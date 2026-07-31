// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'

import { HomeChoiceCard } from './choice-card'

afterEach(cleanup)

describe('HomeChoiceCard', () => {
  it('只根据输入渲染一个可导航入口', () => {
    render(
      <MemoryRouter>
        <HomeChoiceCard
          to="/quick-start"
          eyebrow="ONE COMMAND"
          index="01"
          title="快速开始"
          description="用一句话描述角色。"
          actionLabel="写下角色设定"
          tone="dark"
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /快速开始/ }).getAttribute('href')).toBe('/quick-start')
  })

  it('can expose a separate secondary destination without nesting links', () => {
    render(
      <MemoryRouter>
        <HomeChoiceCard
          to="/projects/new"
          eyebrow="PROJECT SETUP"
          index="02"
          title="新建项目"
          description="建立角色生产项目。"
          actionLabel="开始创建项目"
          secondaryAction={{ to: '/projects', label: '查看项目历史' }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /新建项目/ }).getAttribute('href')).toBe(
      '/projects/new',
    )
    expect(screen.getByRole('link', { name: '查看项目历史' }).getAttribute('href')).toBe(
      '/projects',
    )
  })
})
