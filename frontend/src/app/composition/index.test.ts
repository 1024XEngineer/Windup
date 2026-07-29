import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadAppServices } from './index'

describe('应用组合选择', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('preview 用 Mock 走 Quick Start 创建项目和后端形状 WorkflowRun', async () => {
    vi.stubEnv('VITE_APP_ENV', 'preview')
    const services = await loadAppServices()

    const session = await services.quickStart.start({ prompt: '戴斗篷的像素骑士' })
    const project = await services.projects.get(session.projectId)
    const initialRun = await services.workflowRuns.get(session.runId)

    expect(project.id).toBe(session.projectId)
    expect(initialRun).toMatchObject({
      id: session.runId,
      projectId: session.projectId,
      driver: 'ai',
      purpose: 'create_character',
      prompt: '戴斗篷的像素骑士',
      status: 'active',
    })
    await vi.waitFor(async () => {
      const latest = await services.workflowRuns.get(session.runId)
      const revision = latest?.revisions.find((item) => item.id === latest.currentRevisionId)
      expect(latest?.status).toBe('active')
      expect(revision?.nodes.find((node) => node.status === 'active')?.type).toBe('review')
      expect(revision?.exportStatus).toBe('not_exported')
    })
    const run = await services.workflowRuns.get(session.runId)
    expect(run?.characterId).toBeTruthy()
    expect(run?.outfitId).toBeTruthy()

    const characters = await services.characters.listByProject(project.id)
    expect(characters).toHaveLength(1)
    expect(characters[0]?.outfits[0]).toMatchObject({
      characterTemplateUrl: expect.stringContaining('/template-1.png'),
      candidateCharacterTemplates: expect.any(Array),
    })
    expect(characters[0]?.outfits[0]?.candidateCharacterTemplates).toHaveLength(6)
    expect(characters[0]?.outfits[0]?.baseFrames.length).toBeGreaterThan(0)
    expect(characters[0]?.outfits[0]?.actions[0]).toMatchObject({
      status: 'confirmed',
      frames: expect.any(Array),
    })
    expect(characters[0]?.outfits[0]?.actions[0]?.frames).toHaveLength(8)
  })

  it('未配置 Review/Export 时不会伪造通过和导出成功', async () => {
    vi.stubEnv('VITE_APP_ENV', 'preview')
    const services = await loadAppServices()
    const session = await services.quickStart.start({ prompt: '需要审核的像素角色' })

    await vi.waitFor(async () => {
      const run = await services.workflowRuns.get(session.runId)
      const revision = run?.revisions.find((item) => item.id === run.currentRevisionId)
      expect(revision?.nodes.find((node) => node.status === 'active')?.type).toBe('review')
    })
    await expect(services.workflowController.advance(session.runId)).rejects.toThrow(
      'Review 能力尚未配置',
    )
  })

  it('Quick Start 返回会话后可在自动流程完成前中断', async () => {
    vi.stubEnv('VITE_APP_ENV', 'preview')
    const services = await loadAppServices()

    const session = await services.quickStart.start({ prompt: '允许中断的像素角色' })
    await services.quickStart.interrupt(session.runId)

    await vi.waitFor(async () => {
      await expect(services.workflowRuns.get(session.runId)).resolves.toMatchObject({
        status: 'interrupted',
      })
    })
  })

  it('已完成的 WorkflowRun 不会被会话中断改写终态', async () => {
    vi.stubEnv('VITE_APP_ENV', 'preview')
    const services = await loadAppServices()
    const run = await services.workflowRuns.create({
      projectId: 'project-1',
      driver: 'manual',
      purpose: 'create_character',
    })
    await services.workflowRuns.save({ ...run, status: 'completed' })

    await services.quickStart.interrupt(run.id)

    await expect(services.workflowRuns.get(run.id)).resolves.toMatchObject({ status: 'completed' })
  })

  it('步骤失败时同步持久化 node、revision 和 run 的失败状态', async () => {
    vi.stubEnv('VITE_APP_ENV', 'preview')
    const services = await loadAppServices()
    const run = await services.workflowRuns.create({
      projectId: 'project-1',
      driver: 'manual',
      purpose: 'add_action',
      characterId: 'missing-character',
      outfitId: 'missing-outfit',
      characterTemplateUrl: 'https://media.test/template.png',
      baseFrameUrls: ['https://media.test/base.png'],
    })

    await expect(services.workflowController.advance(run.id)).rejects.toThrow('角色不存在')

    const failed = await services.workflowRuns.get(run.id)
    const revision = failed?.revisions.find((item) => item.id === failed.currentRevisionId)
    expect(failed?.status).toBe('failed')
    expect(revision?.status).toBe('failed')
    expect(revision?.nodes.find((node) => node.type === 'action-setup')?.status).toBe('failed')
  })

  it('从指定历史节点重启时建立可推进的新执行线', async () => {
    vi.stubEnv('VITE_APP_ENV', 'preview')
    const services = await loadAppServices()
    const session = await services.quickStart.start({ prompt: '可重启的像素角色' })
    let run = await services.workflowRuns.get(session.runId)
    await vi.waitFor(async () => {
      const latest = await services.workflowRuns.get(session.runId)
      run = latest
      const current = latest?.revisions.find((item) => item.id === latest.currentRevisionId)
      expect(current?.nodes.find((node) => node.status === 'active')?.type).toBe('review')
    })
    const restartRun = run
    if (!restartRun) throw new Error('测试工作流不存在')
    const source = restartRun.revisions.find((item) => item.id === restartRun.currentRevisionId)
    const restartNode = source?.nodes.find((node) => node.type === 'first-frame')
    if (!source || !restartNode) throw new Error('测试重启节点不存在')

    const restarted = await services.workflowRestart.restart({
      run: restartRun,
      sourceRevisionId: source.id,
      node: restartNode,
    })
    const revision = restarted.revisions.find((item) => item.id === restarted.currentRevisionId)

    expect(restarted.revisions.find((item) => item.id === source.id)?.status).toBe('abandoned')
    expect(revision?.nodes.find((node) => node.type === 'first-frame')?.status).toBe('active')
    expect(revision?.nodes.find((node) => node.type === 'complete-animation')?.status).toBe(
      'locked',
    )
    await expect(services.workflowController.advance(restarted.id)).resolves.toBeTruthy()
  })

  it('Mock Character Repository 以整棵 Character 为单位更新', async () => {
    vi.stubEnv('VITE_APP_ENV', 'preview')
    const services = await loadAppServices()
    const created = await services.characters.create({
      projectId: 'project-1',
      name: '角色',
      description: '初始描述',
    })

    const updated = await services.characters.update({ ...created, name: '新角色名' })

    expect((await services.characters.get(created.id)).name).toBe('新角色名')
    expect(updated.updatedAt >= created.updatedAt).toBe(true)
  })

  it('Mock 任务事件使用 TaskEvent 形状，不泄漏 Task.id 字段', async () => {
    vi.stubEnv('VITE_APP_ENV', 'preview')
    const services = await loadAppServices()
    const task = await services.imageGeneration.submit({
      type: 'character_template',
      projectId: 'project-1',
      prompt: '像素骑士',
      referenceMedia: [],
    })

    const event = await new Promise<
      Parameters<typeof services.taskEvents.subscribe>[1] extends (event: infer T) => void
        ? T
        : never
    >((resolve) => {
      services.taskEvents.subscribe(task.id, resolve)
    })

    expect(event).toMatchObject({
      taskId: task.id,
      type: 'character_template',
      status: 'completed',
    })
    expect(event).not.toHaveProperty('id')
  })
})
