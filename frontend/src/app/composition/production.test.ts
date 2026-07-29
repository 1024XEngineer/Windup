import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProductionAppServices } from './production'

describe('生产应用组合', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('错误契约撤回后不会构造真实 Project Adapter', async () => {
    const services = createProductionAppServices()

    await expect(services.projects.list()).rejects.toThrow('Project API 契约尚未冻结')
  })

  it('所有已冻结端口都有唯一装配位置，未配置时明确失败', async () => {
    const services = createProductionAppServices()

    await expect(services.workflowRuns.get('run-1')).rejects.toThrow(
      'WorkflowRun Repository 尚未配置',
    )

    await expect(
      services.imageGeneration.submit({
        type: 'character_template',
        projectId: 'project-1',
        prompt: 'reference',
        referenceMedia: [],
      }),
    ).rejects.toThrow('图片生成能力尚未配置')

    await expect(services.tasks.get('task-1')).rejects.toThrow('任务存取尚未配置')
    await expect(services.tasks.cancel('task-1')).rejects.toThrow('任务存取尚未配置')
    expect(() => services.taskEvents.subscribe('task-1', () => undefined)).toThrow(
      '任务事件订阅尚未配置',
    )

    await expect(services.quickStart.interrupt('run-1')).rejects.toThrow('Quick Start 用例尚未配置')
    await expect(services.quickStart.getSession('run-1')).rejects.toThrow(
      'Quick Start 用例尚未配置',
    )
    await expect(
      services.productionEngine.cancelAttempt({
        runId: 'run-1',
        revisionId: 'revision-1',
        nodeId: 'node-1',
        attemptId: 'attempt-1',
      }),
    ).rejects.toThrow('制作引擎尚未配置')
    await expect(
      services.workflowRestart.restart({
        run: {} as never,
        sourceRevisionId: 'revision-1',
        node: {} as never,
      }),
    ).rejects.toThrow('流程重启用例尚未配置')
    await expect(
      services.playtestInspections.record({
        characterId: 'character-1',
        outfitId: 'outfit-1',
        source: { runId: 'run-1', revisionId: 'revision-1' },
        status: 'passed',
      }),
    ).rejects.toThrow('Playtest 核验记录尚未配置')
  })

  it('生产环境为已冻结的媒体上传契约注入真实 Adapter', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: {
              url: 'https://media.windup.test/reference/reference.png',
              object_key: 'reference-image/uuid.png',
              filename: 'reference.png',
              content_type: 'image/png',
              size: 5,
            },
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const services = createProductionAppServices()

    await expect(
      services.imageUpload.upload(new File(['image'], 'reference.png', { type: 'image/png' })),
    ).resolves.toBe('https://media.windup.test/reference/reference.png')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/media/upload?category=reference-image')
  })
})
