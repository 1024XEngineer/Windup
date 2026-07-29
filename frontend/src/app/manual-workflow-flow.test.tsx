// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDevelopmentAppServices } from './composition/development'
import { App } from './index'

describe('手动 Workflow 入口', () => {
  beforeEach(() => window.history.replaceState(null, '', '/projects'))
  afterEach(cleanup)

  it('从已有项目创建 WorkflowRun 后进入 Workflow Editor', async () => {
    const services = createDevelopmentAppServices()
    const project = await services.projects.create({
      name: '测试项目',
      perspective: 'side',
      directionalMovement: 'single',
      spriteSize: { width: 64, height: 64 },
    })
    window.history.replaceState(null, '', `/projects/${project.id}`)

    render(<App services={services} />)
    fireEvent.click(await screen.findByRole('button', { name: '开始工作流' }))

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/workflow-editor\/run-/))
    expect(await screen.findByText(/运行标识：run-/)).toBeTruthy()
  })

  it('给已有角色加动作时预填造型数据并直接定位生成阶段', async () => {
    const services = createDevelopmentAppServices()
    const project = await services.projects.create({
      name: '测试项目',
      perspective: 'side',
      directionalMovement: 'single',
      spriteSize: { width: 64, height: 64 },
    })
    const created = await services.characters.create({
      projectId: project.id,
      name: '小骑士',
      description: '角色描述',
    })
    await services.characters.update({
      ...created,
      outfits: [
        {
          id: 'outfit-1',
          characterId: created.id,
          name: '斗篷造型',
          candidateCharacterTemplates: [],
          characterTemplateUrl: 'https://media.test/template.png',
          baseFrames: [{ imageUrl: 'https://media.test/base-front.png' }],
          actions: [],
        },
      ],
    })
    window.history.replaceState(null, '', `/projects/${project.id}`)
    render(<App services={services} />)

    fireEvent.click(await screen.findByRole('button', { name: '为 斗篷造型 添加动作' }))

    await waitFor(() =>
      expect(window.location.pathname).toMatch(/^\/workflow-editor\/run-\d+\/action-setup$/),
    )
    const runId = window.location.pathname.split('/')[2] ?? ''
    await expect(services.workflowRuns.get(runId)).resolves.toMatchObject({
      characterId: created.id,
      outfitId: 'outfit-1',
      purpose: 'add_action',
    })
  })
})
