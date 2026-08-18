/** @vitest-environment jsdom */
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes } from 'react-router'

import {
  WorkflowRunConflictError,
  type Character,
  type CharacterTemplateWorkflowNode,
  type Generation,
  type GenerationApis,
  type MediaReference,
  type Project,
  type WorkflowRun,
  type WorkflowRunApis,
} from '@/entities'
import { createWorkflowController, type WorkflowController } from '@/features/workflow-controller'
import { WorkflowEditorPage } from './index'
import type { WorkflowEditorSession } from './runtime'

const { defaultSessionLoader, flowProps, fitView } = vi.hoisted(() => ({
  defaultSessionLoader: vi.fn(),
  flowProps: { current: null as Record<string, unknown> | null },
  fitView: vi.fn(),
}))

vi.mock('./runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtime')>()
  return {
    ...actual,
    createDefaultRealWorkflowEditorSession: defaultSessionLoader,
  }
})

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    Controls: () => null,
    Handle: () => null,
    ReactFlow: ({ nodes, children, ...props }: TestFlowProps) => {
      flowProps.current = { nodes, ...props }
      return (
        <div>
          {nodes.map((node) => (
            <article key={node.id} aria-label={node.data.title}>
              {node.data.content}
            </article>
          ))}
          {children}
        </div>
      )
    },
    useReactFlow: () => ({ fitView }),
  }
})

interface TestCanvasNode {
  id: string
  deletable?: boolean
  draggable?: boolean
  dragHandle?: string
  data: { title: string; content: ReactNode }
}

interface TestFlowProps extends Record<string, unknown> {
  nodes: TestCanvasNode[]
  children?: ReactNode
}

beforeEach(() => {
  defaultSessionLoader.mockReset()
  fitView.mockClear()
  flowProps.current = null
  window.history.replaceState({}, '', '/')
})
afterEach(cleanup)

describe('WorkflowEditorPage real runtime boundary', () => {
  it('默认路由只恢复真实 WorkflowRun 会话', async () => {
    defaultSessionLoader.mockResolvedValue(createSession())
    window.history.replaceState({}, '', '/workflow-editor/42')

    renderEditor('/workflow-editor/42')

    expect(await screen.findByLabelText('当前项目')).toBeTruthy()
    expect(screen.queryByText('真实 WorkflowRun 接口')).toBeNull()
    expect(defaultSessionLoader).toHaveBeenCalledWith('42')
  })

  it('会话加载失败时展示恢复错误', async () => {
    defaultSessionLoader.mockRejectedValue(new Error('WorkflowRun 加载失败'))

    renderEditor('/workflow-editor/42')

    expect(await screen.findByText('WorkflowRun 加载失败')).toBeTruthy()
  })

  it('在角色设定卡片提交描述后由 Controller 持久化并固定输入', async () => {
    const session = createSession()
    defaultSessionLoader.mockResolvedValue(session)

    renderEditor('/workflow-editor/42')

    const promptInput = await screen.findByRole('textbox', { name: '角色描述' })
    expect(screen.queryByRole('textbox', { name: /角色名称/ })).toBeNull()
    await act(async () => {
      fireEvent.change(promptInput, { target: { value: '戴红围巾的短发少年冒险家' } })
    })
    fireEvent.click(screen.getByRole('button', { name: '生成角色候选' }))

    await waitFor(() =>
      expect(session.controller.getWorkflow().nodes[0]).toMatchObject({
        status: 'passed',
        phase: 'completed',
        input: { prompt: '戴红围巾的短发少年冒险家', referenceMedia: [] },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '角色描述' })).toBeNull())
  })

  it('上传角色参考图期间禁止生成，成功后写回 WorkflowRun', async () => {
    const pendingUpload = deferred<MediaReference>()
    const uploadReferenceImage = vi.fn(() => pendingUpload.promise)
    const session = createSession(workflowFixture(), { uploadReferenceImage })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    const promptInput = await screen.findByRole('textbox', { name: '角色描述' })
    fireEvent.change(promptInput, { target: { value: '戴红围巾的短发少年冒险家' } })
    const file = new File(['pixels'], 'reference.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('角色参考图'), { target: { files: [file] } })

    expect(screen.getByText('正在上传参考图…')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '生成角色候选' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await act(async () => {
      pendingUpload.resolve('opaque-reference-1' as MediaReference)
      await pendingUpload.promise
    })

    await waitFor(() =>
      expect(session.controller.getWorkflow().nodes[0]).toMatchObject({
        input: {
          prompt: '戴红围巾的短发少年冒险家',
          referenceMedia: ['opaque-reference-1'],
        },
      }),
    )
    expect(screen.getByText('已关联 1 个参考媒体')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '生成角色候选' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('上传失败时提示错误且不写入 WorkflowRun', async () => {
    const uploadReferenceImage = vi.fn().mockRejectedValue(new Error('对象存储暂不可用'))
    const session = createSession(workflowFixture(), { uploadReferenceImage })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    const file = new File(['pixels'], 'retry.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('角色参考图'), { target: { files: [file] } })

    expect((await screen.findByRole('alert')).textContent).toContain('对象存储暂不可用')
    expect(session.controller.getWorkflow().nodes[0]).toMatchObject({
      status: 'active',
      phase: 'configuring',
      input: { referenceMedia: [] },
    })
  })

  it('页面卸载时取消在途参考图上传并忽略迟到结果', async () => {
    const pendingUpload = deferred<MediaReference>()
    let uploadSignal: AbortSignal | undefined
    const session = createSession(workflowFixture(), {
      uploadReferenceImage: vi.fn((_file: File, signal?: AbortSignal) => {
        uploadSignal = signal
        return pendingUpload.promise
      }),
    })
    const updateCharacterSetup = vi.spyOn(session.controller, 'updateCharacterSetup')
    defaultSessionLoader.mockResolvedValue(session)
    const view = renderEditor('/workflow-editor/42')

    const file = new File(['pixels'], 'slow.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('角色参考图'), { target: { files: [file] } })
    await waitFor(() => expect(uploadSignal).toBeDefined())

    view.unmount()
    expect(uploadSignal?.aborted).toBe(true)

    await act(async () => {
      pendingUpload.resolve('late-reference' as MediaReference)
      await pendingUpload.promise
    })
    expect(updateCharacterSetup).not.toHaveBeenCalled()
  })

  it('页面卸载后会释放迟到返回的 Workflow Editor 会话', async () => {
    const pendingSession = deferred<WorkflowEditorSession>()
    const session = createSession()
    const dispose = vi.spyOn(session.controller, 'dispose')
    defaultSessionLoader.mockReturnValue(pendingSession.promise)
    const view = renderEditor('/workflow-editor/42')

    view.unmount()
    await act(async () => {
      pendingSession.resolve(session)
      await pendingSession.promise
    })

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('真实 Generation 尚未实现时展示接口错误，不回退到演示候选', async () => {
    defaultSessionLoader.mockResolvedValue(createSession())
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '生成角色候选' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Generation 后端尚未实现')
    expect(screen.queryByRole('button', { name: /选择角色候选/ })).toBeNull()
  })

  it('保存发生乐观锁冲突时提示加载当前 WorkflowRun 的最新版本', async () => {
    const session = createSession(workflowFixture(), {
      workflowRunApis: {
        update: vi.fn(async () => {
          throw new WorkflowRunConflictError('执行记录版本冲突，请刷新后重试')
        }),
      },
    })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '生成角色候选' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('工作流已在其他位置更新，请加载最新版本后继续。')
    expect(screen.getByRole('link', { name: '加载最新版本' }).getAttribute('href')).toBe(
      '/workflow-editor/42',
    )
  })

  it('恢复后台任务时发生乐观锁冲突也提示加载最新版本', async () => {
    const session = createSession()
    vi.spyOn(session.controller, 'resume').mockRejectedValue(
      new WorkflowRunConflictError('执行记录版本冲突，请刷新后重试'),
    )
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('工作流已在其他位置更新，请加载最新版本后继续。')
    expect(screen.getByRole('link', { name: '加载最新版本' }).getAttribute('href')).toBe(
      '/workflow-editor/42',
    )
  })

  it('恢复后台任务的一般错误保留在恢复提示中', async () => {
    const session = createSession()
    vi.spyOn(session.controller, 'resume').mockRejectedValue(new Error('后台任务恢复失败'))
    defaultSessionLoader.mockResolvedValue(session)

    renderEditor('/workflow-editor/42')

    expect(await screen.findByText('后台任务恢复失败')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '加载最新版本' })).toBeNull()
  })

  it('确认身份母版后采用会话创建的 Character 继续动作流程', async () => {
    const session = createSession(selectingTemplateWorkflow(3, 'character-task'), {
      generationApis: generationApisFixture({
        get: vi.fn().mockResolvedValue(characterGeneration('character')),
      }),
    })
    const confirmCharacterTemplate = vi.fn(async (nodeId: string, imageUrl: string) => {
      await session.controller.confirmCharacterTemplate(nodeId, imageUrl, 'character-1')
      const character = characterFixture()
      return {
        ...character,
        outfits: character.outfits.map((outfit, index) =>
          index === 0 ? { ...outfit, previewUrl: imageUrl } : outfit,
        ),
      }
    })
    session.confirmCharacterTemplate = confirmCharacterTemplate
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '选择角色候选 1' }))
    fireEvent.click(screen.getByRole('button', { name: '确认身份母版' }))

    await waitFor(() =>
      expect(confirmCharacterTemplate).toHaveBeenCalledWith(
        'character-template',
        'https://assets.windup.test/character.png',
      ),
    )
    expect(await screen.findByRole('button', { name: '导出角色母版' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '添加动作分支' }))
    expect((screen.getByRole('button', { name: '生成动作 ›' }) as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('切换 WorkflowRun 时清空上一条任务的临时动作菜单', async () => {
    defaultSessionLoader
      .mockResolvedValueOnce(createSession(completedTemplateWorkflow('42')))
      .mockResolvedValueOnce(createSession(completedTemplateWorkflow('43')))

    render(
      <MemoryRouter initialEntries={['/workflow-editor/42']}>
        <Link to="/workflow-editor/43">下一条 WorkflowRun</Link>
        <Routes>
          <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '添加动作分支' }))
    expect(screen.getByRole('button', { name: '生成动作 ›' })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: '下一条 WorkflowRun' }))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: '已确认身份母版' }).getAttribute('src')).toBe(
        'https://assets.windup.test/43.png',
      ),
    )

    expect(screen.queryByRole('button', { name: '生成动作 ›' })).toBeNull()
  })

  it('切换 WorkflowRun 后忽略上一条任务迟到的命令错误', async () => {
    const pendingGeneration = deferred<Generation>()
    const createGeneration = vi.fn(() => pendingGeneration.promise)
    defaultSessionLoader
      .mockResolvedValueOnce(
        createSession(workflowFixture(), {
          generationApis: generationApisFixture({ create: createGeneration }),
        }),
      )
      .mockResolvedValueOnce(createSession(completedTemplateWorkflow('43')))

    render(
      <MemoryRouter initialEntries={['/workflow-editor/42']}>
        <Link to="/workflow-editor/43">下一条 WorkflowRun</Link>
        <Routes>
          <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '生成角色候选' }))
    await waitFor(() => expect(createGeneration).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('link', { name: '下一条 WorkflowRun' }))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: '已确认身份母版' }).getAttribute('src')).toBe(
        'https://assets.windup.test/43.png',
      ),
    )

    await act(async () => {
      pendingGeneration.reject(new Error('旧 WorkflowRun 的迟到错误'))
      await pendingGeneration.promise.catch(() => undefined)
    })

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('只采用同一 WorkflowRun 内最后一次 Generation 读取结果', async () => {
    const oldRead = deferred<Generation | null>()
    const latestRead = deferred<Generation | null>()
    defaultSessionLoader.mockResolvedValue(createGenerationRaceSession(oldRead, latestRead))

    renderEditor('/workflow-editor/42')
    await waitFor(() => expect(latestFlowProps().nodes).toHaveLength(2))

    await act(async () => {
      latestRead.resolve(characterGeneration('new'))
      await latestRead.promise
    })
    expect(screen.getByRole('img', { name: '角色候选 1' }).getAttribute('src')).toContain(
      '/new.png',
    )

    await act(async () => {
      oldRead.resolve(characterGeneration('old'))
      await oldRead.promise
    })
    expect(screen.getByRole('img', { name: '角色候选 1' }).getAttribute('src')).toContain(
      '/new.png',
    )
  })

  it('从 WorkflowRun 绑定角色中明确选择造型，并只提交后端支持的动作类型', async () => {
    const session = createSession(completedTemplateWorkflow('42'), {
      character: characterFixture(),
    })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '添加动作分支' }))
    fireEvent.click(screen.getByRole('button', { name: '生成动作 ›' }))
    fireEvent.click(screen.getByRole('button', { name: '选择造型 夜行装' }))

    expect(screen.queryByRole('button', { name: /Jump/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Attack 攻击/ }))

    await waitFor(() =>
      expect(session.controller.getWorkflow().nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'action-first-frame',
            // 落库的动作名是中文短名，不含菜单里的英文前缀。
            input: expect.objectContaining({ outfitId: 'night', type: 'attack', name: '攻击' }),
          }),
        ]),
      ),
    )
  })

  it('展示三张动作首帧候选并确认用户选择的一张', async () => {
    const workflow = reviewingActionWorkflow()
    const firstFrame = workflow.nodes.find((node) => node.type === 'action-first-frame')
    if (!firstFrame || firstFrame.type !== 'action-first-frame') throw new Error('missing frame')
    firstFrame.status = 'active'
    firstFrame.phase = 'selecting'
    firstFrame.generations = [{ taskId: 'first-frame-task', role: 'first_frame' }]
    firstFrame.selectedFirstFrameUrl = null
    for (const node of workflow.nodes) {
      if (node.type === 'action-generation-method') {
        node.status = 'locked'
        node.phase = 'selecting'
        node.method = null
      } else if (node.type === 'action-full-frame') {
        node.status = 'locked'
        node.phase = 'ready'
        node.generations = []
      } else if (node.type === 'review') {
        node.status = 'locked'
      }
    }
    const candidates = [
      'https://assets.windup.test/first-1.png',
      'https://assets.windup.test/first-2.png',
      'https://assets.windup.test/first-3.png',
    ]
    const session = createSession(workflow, {
      character: characterFixture(),
      generationApis: generationApisFixture({
        get: vi.fn(async () => ({
          id: 'first-frame-task',
          projectId: '1',
          type: 'first_frame' as const,
          status: 'completed' as const,
          result: {
            type: 'first_frame' as const,
            images: candidates.map((url) => ({ url })),
          },
          error: null,
        })) as GenerationApis['get'],
      }),
    })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    expect(await screen.findByRole('img', { name: '动作首帧候选 1' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '动作首帧候选 2' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '动作首帧候选 3' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '选择动作首帧 2' }))
    fireEvent.click(screen.getByRole('button', { name: '确认动作首帧' }))

    await waitFor(() =>
      expect(session.controller.getWorkflow().nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: firstFrame.id,
            selectedFirstFrameUrl: candidates[1],
            status: 'passed',
          }),
        ]),
      ),
    )
  })

  it('发布与审核命令失败时显示错误并释放分支锁', async () => {
    const publishReviewedAction = vi.fn(() => Promise.reject(new Error('审核保存失败')))
    const session = createSession(reviewingActionWorkflow(), {
      character: { ...characterFixture(), outfits: [] },
      generationApis: generationApisFixture({
        get: vi.fn().mockResolvedValue(completeAnimationGeneration()),
      }),
      publishReviewedAction,
    })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '审核通过' }))

    expect((await screen.findByRole('alert')).textContent).toContain('审核保存失败')
    expect(publishReviewedAction).toHaveBeenCalledWith('action-walk:review')
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '审核通过' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })

  it('同一节点挂多个生成任务时按角色分别读取，后写入的不覆盖前一个', async () => {
    const workflow = selectingTemplateWorkflow(3, 'template-task')
    workflow.nodes[1] = {
      ...(workflow.nodes[1] as CharacterTemplateWorkflowNode),
      generations: [
        { taskId: 'template-task', role: 'character_template' },
        { taskId: 'animation-task', role: 'complete_animation' },
      ],
    }
    defaultSessionLoader.mockResolvedValue(
      createSession(workflow, {
        generationApis: generationApisFixture({
          get: vi.fn(async (_projectId: string, taskId: string) =>
            taskId === 'template-task'
              ? characterGeneration('template')
              : completeAnimationGeneration(),
          ) as GenerationApis['get'],
        }),
      }),
    )

    renderEditor('/workflow-editor/42')

    expect((await screen.findByRole('img', { name: '角色候选 1' })).getAttribute('src')).toContain(
      '/template.png',
    )
  })

  it('已删除的节点不再读取生成结果', async () => {
    const workflow = selectingTemplateWorkflow(3, 'template-task')
    workflow.nodes[1] = {
      ...(workflow.nodes[1] as CharacterTemplateWorkflowNode),
      deletedAt: '2026-08-11T00:00:00.000Z',
    }
    const get = vi.fn(async () => characterGeneration('template'))
    defaultSessionLoader.mockResolvedValue(
      createSession(workflow, {
        generationApis: generationApisFixture({ get: get as GenerationApis['get'] }),
      }),
    )

    renderEditor('/workflow-editor/42')
    await waitFor(() => expect(latestFlowProps().nodes).toHaveLength(1))

    expect(get).not.toHaveBeenCalled()
  })

  it('WorkflowRun 推进但节点集合不变时不重置画布视角', async () => {
    const controlled = createRestartSelectionSession()
    defaultSessionLoader.mockResolvedValue(controlled.session)
    renderEditor('/workflow-editor/42')
    await waitFor(() => expect(latestFlowProps().nodes).toHaveLength(2))
    await waitFor(() => expect(fitView).toHaveBeenCalled())

    const afterFirstFit = fitView.mock.calls.length
    act(() => controlled.emit(selectingTemplateWorkflow(9, 'another-task')))
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(fitView.mock.calls.length).toBe(afterFirstFit)
  })

  it('新增动作分支后重新取景，让新节点进入视野', async () => {
    const controlled = createRestartSelectionSession()
    defaultSessionLoader.mockResolvedValue(controlled.session)
    renderEditor('/workflow-editor/42')
    await waitFor(() => expect(latestFlowProps().nodes).toHaveLength(2))
    await waitFor(() => expect(fitView).toHaveBeenCalled())

    const afterFirstFit = fitView.mock.calls.length
    act(() => controlled.emit(reviewingActionWorkflow()))
    await waitFor(() => expect(fitView.mock.calls.length).toBeGreaterThan(afterFirstFit))
  })

  it('一条动作分支执行命令时不阻塞其他分支的操作', async () => {
    const pendingPublish = deferred<Character>()
    defaultSessionLoader.mockResolvedValue(
      createSession(reviewingActionWorkflow(), {
        character: characterFixture(),
        publishReviewedAction: () => pendingPublish.promise,
      }),
    )
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '审核通过' }))
    expect((screen.getByRole('button', { name: '审核通过' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.click(screen.getByRole('button', { name: '添加动作分支' }))
    expect((screen.getByRole('button', { name: '生成动作 ›' }) as HTMLButtonElement).disabled).toBe(
      false,
    )

    await act(async () => {
      pendingPublish.resolve(characterFixture())
      await pendingPublish.promise
    })
  })

  it('两条分支同时执行命令时，先起的那条不会因为后起的而解锁', async () => {
    // 并行分支各自持锁：B 开始执行不能把 A 的锁顶掉，否则 A 的按钮会重新可点，
    // 用户再点一次就是对同一个动作重复发布 + 重复审核。
    const pendingA = deferred<Character>()
    const pendingB = deferred<Character>()
    const publishReviewedAction = vi.fn((reviewNodeId: string) =>
      reviewNodeId === 'action-a:review' ? pendingA.promise : pendingB.promise,
    )
    defaultSessionLoader.mockResolvedValue(
      createSession(reviewingActionWorkflow('action-a', 'action-b'), {
        character: characterFixture(),
        publishReviewedAction,
      }),
    )
    renderEditor('/workflow-editor/42')

    const approveButtons = await screen.findAllByRole('button', { name: '审核通过' })
    expect(approveButtons).toHaveLength(2)
    const [approveA, approveB] = approveButtons as [HTMLButtonElement, HTMLButtonElement]

    fireEvent.click(approveA)
    expect(approveA.disabled).toBe(true)

    fireEvent.click(approveB)
    await waitFor(() => expect(publishReviewedAction).toHaveBeenCalledTimes(2))

    // A 的请求仍未返回，它必须还锁着。
    expect(approveA.disabled).toBe(true)
    expect(approveB.disabled).toBe(true)

    fireEvent.click(approveA)
    expect(publishReviewedAction).toHaveBeenCalledTimes(2)

    await act(async () => {
      pendingA.resolve(characterFixture())
      pendingB.resolve(characterFixture())
      await Promise.all([pendingA.promise, pendingB.promise])
    })
  })

  it('已经到终态的生成结果只读取一次，后续推进复用缓存', async () => {
    // WorkflowRun 每推进一步都会 emit，若每次都重拉全部结果，一条多分支的流程
    // 点一次按钮就是十几个 GET。终态结果不会再变，没有重读的理由。
    const controlled = createRestartSelectionSession()
    defaultSessionLoader.mockResolvedValue(controlled.session)
    renderEditor('/workflow-editor/42')

    await waitFor(() => expect(screen.getByRole('img', { name: '角色候选 1' })).toBeTruthy())
    const reads = controlled.session.controller.getGeneration as ReturnType<typeof vi.fn>
    const afterFirstRead = reads.mock.calls.length
    expect(afterFirstRead).toBeGreaterThan(0)

    act(() => controlled.emit(selectingTemplateWorkflow(7, 'old-task')))
    act(() => controlled.emit(selectingTemplateWorkflow(8, 'old-task')))
    await waitFor(() => expect(latestFlowProps().nodes).toHaveLength(2))

    expect(reads.mock.calls.length).toBe(afterFirstRead)
  })

  it('未到终态的生成任务每次推进都重新读取', async () => {
    const controlled = createRestartSelectionSession({ status: 'running' })
    defaultSessionLoader.mockResolvedValue(controlled.session)
    renderEditor('/workflow-editor/42')

    const reads = controlled.session.controller.getGeneration as ReturnType<typeof vi.fn>
    await waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(0))
    const afterFirstRead = reads.mock.calls.length

    act(() => controlled.emit(selectingTemplateWorkflow(7, 'old-task')))
    await waitFor(() => expect(reads.mock.calls.length).toBeGreaterThan(afterFirstRead))
  })

  it('失败节点可以从当前节点重做', async () => {
    const session = createSession(failedTemplateWorkflow())
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '从此节点重做' }))

    expect(await screen.findByRole('button', { name: '生成角色候选' })).toBeTruthy()
    expect(session.controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'ready',
      error: null,
    })
  })

  it('节点重做后不会沿用上一轮 Generation 的候选选择', async () => {
    const controlled = createRestartSelectionSession()
    defaultSessionLoader.mockResolvedValue(controlled.session)
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '选择角色候选 1' }))
    expect(
      (screen.getByRole('button', { name: '确认身份母版' }) as HTMLButtonElement).disabled,
    ).toBe(false)

    act(() => controlled.emit(failedTemplateWorkflow()))
    fireEvent.click(await screen.findByRole('button', { name: '从此节点重做' }))
    act(() => controlled.emit(selectingTemplateWorkflow(6, 'new-task')))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: '角色候选 1' }).getAttribute('src')).toContain(
        '/new.png',
      ),
    )

    expect(
      (screen.getByRole('button', { name: '确认身份母版' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('Generation 候选集合变化时使旧选择失效', async () => {
    const controlled = createRestartSelectionSession()
    defaultSessionLoader.mockResolvedValue(controlled.session)
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '选择角色候选 1' }))
    act(() => controlled.emit(selectingTemplateWorkflow(4, 'new-task')))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: '角色候选 1' }).getAttribute('src')).toContain(
        '/new.png',
      ),
    )

    expect(
      (screen.getByRole('button', { name: '确认身份母版' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('生成接口提交失败后仍保留角色候选重试入口', async () => {
    defaultSessionLoader.mockResolvedValue(createSession())
    renderEditor('/workflow-editor/42')

    fireEvent.click(await screen.findByRole('button', { name: '生成角色候选' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Generation 后端尚未实现')
    expect(screen.getByRole('button', { name: '生成角色候选' })).toBeTruthy()
  })

  it('恢复候选读取失败时展示错误并允许重新读取', async () => {
    const generationApis = generationApisFixture()
    defaultSessionLoader.mockResolvedValue(
      createSession(selectingTemplateWorkflow(3, 'existing-task'), { generationApis }),
    )
    renderEditor('/workflow-editor/42')

    expect((await screen.findByRole('alert')).textContent).toContain('Generation 后端尚未实现')
    fireEvent.click(screen.getByRole('button', { name: '重试读取生成结果' }))

    await waitFor(() => expect(generationApis.get).toHaveBeenCalledTimes(2))
  })

  it('恢复生成中节点失败后仍可从该节点重做', async () => {
    const session = createSession(generatingTemplateWorkflow())
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')

    expect((await screen.findByRole('alert')).textContent).toContain('Generation 后端尚未实现')
    fireEvent.click(await screen.findByRole('button', { name: '从此节点重做' }))

    expect(await screen.findByRole('button', { name: '生成角色候选' })).toBeTruthy()
    expect(session.controller.getWorkflow().nodes[1]).toMatchObject({
      status: 'active',
      phase: 'ready',
      error: null,
    })
  })

  it('展示 Controller 的异步错误订阅', async () => {
    let reportError: ((error: Error) => void) | null = null
    const session = createSession()
    session.subscribeErrors = vi.fn((listener) => {
      reportError = listener
      return () => undefined
    })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')
    await screen.findByLabelText('当前项目')

    act(() => reportError?.(new Error('异步保存失败')))

    expect(screen.getByRole('alert').textContent).toContain('异步保存失败')
  })

  it('异步冲突出现后不被后续普通命令错误清除', async () => {
    let reportError: ((error: Error) => void) | null = null
    const create = vi.fn(() => Promise.reject(new Error('Generation 后端尚未实现')))
    const session = createSession(workflowFixture(), {
      generationApis: generationApisFixture({ create: create as GenerationApis['create'] }),
    })
    session.subscribeErrors = vi.fn((listener) => {
      reportError = listener
      return () => undefined
    })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')
    await screen.findByLabelText('当前项目')

    act(() => reportError?.(new WorkflowRunConflictError('执行记录版本冲突，请刷新后重试')))
    expect(screen.getByRole('link', { name: '加载最新版本' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '生成角色候选' }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain(
      '工作流已在其他位置更新，请加载最新版本后继续。',
    )
    expect(screen.getByRole('link', { name: '加载最新版本' })).toBeTruthy()
  })

  it('异步冲突后收到工作流状态通知仍保留刷新入口', async () => {
    let reportError: ((error: Error) => void) | null = null
    let reportRun: ((run: WorkflowRun) => void) | null = null
    const session = createSession()
    const subscribe = session.controller.subscribe.bind(session.controller)
    vi.spyOn(session.controller, 'subscribe').mockImplementation((listener) => {
      reportRun = listener
      return subscribe(listener)
    })
    session.subscribeErrors = vi.fn((listener) => {
      reportError = listener
      return () => undefined
    })
    defaultSessionLoader.mockResolvedValue(session)
    renderEditor('/workflow-editor/42')
    await screen.findByLabelText('当前项目')

    act(() => reportError?.(new WorkflowRunConflictError('执行记录版本冲突，请刷新后重试')))
    expect(screen.getByRole('link', { name: '加载最新版本' })).toBeTruthy()

    act(() => reportRun?.(session.controller.getWorkflow()))
    expect(screen.getByRole('link', { name: '加载最新版本' })).toBeTruthy()
  })

  it('把 React Flow 限定为系统节点的拖动画布，不允许自由连线、重连或删除', async () => {
    defaultSessionLoader.mockResolvedValue(createSession())
    renderEditor('/workflow-editor/42')

    await waitFor(() => expect(latestFlowProps().nodes).toHaveLength(2))

    expect(latestFlowProps()).toMatchObject({
      nodesConnectable: false,
      edgesReconnectable: false,
      deleteKeyCode: null,
    })
    expect('onConnect' in latestFlowProps()).toBe(false)
    expect(latestFlowProps().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deletable: false,
          draggable: true,
          dragHandle: '.workflow-card__handle',
        }),
      ]),
    )
    expect(latestFlowProps().edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selectable: false,
          deletable: false,
          // 未确认的连线画成流动虚线，样式由 workflow-edge--flowing 承担。
          className: 'workflow-edge--flowing',
        }),
      ]),
    )
  })

  it('没有 runId 时不创建替代 WorkflowRun', () => {
    render(
      <MemoryRouter initialEntries={['/workflow-editor']}>
        <Routes>
          <Route path="/workflow-editor" element={<WorkflowEditorPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '工作流编辑器' })).toBeTruthy()
    expect(screen.getByText('需要从已有 WorkflowRun 进入')).toBeTruthy()
    expect(defaultSessionLoader).not.toHaveBeenCalled()
  })
})

function renderEditor(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workflow-editor/:runId" element={<WorkflowEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

interface SessionFixtureOptions {
  character?: Character | null
  generationApis?: GenerationApis
  workflowRunApis?: Partial<WorkflowRunApis>
  uploadReferenceImage?: WorkflowEditorSession['uploadReferenceImage']
  publishReviewedAction?(reviewNodeId: string): Promise<Character>
}

function createSession(
  initialWorkflow = workflowFixture(),
  options: SessionFixtureOptions = {},
): WorkflowEditorSession {
  let workflow = structuredClone(initialWorkflow)
  const workflowRunApis: WorkflowRunApis = {
    async create() {
      return structuredClone(workflow)
    },
    async get() {
      return structuredClone(workflow)
    },
    async update(next) {
      workflow = { ...structuredClone(next), version: workflow.version + 1 }
      return structuredClone(workflow)
    },
    async remove() {},
    ...options.workflowRunApis,
  }
  const generationApis = options.generationApis ?? generationApisFixture()
  const controller = createWorkflowController({
    workflow,
    workflowRunApis,
    generationApis,
    onAsyncError: vi.fn(),
  })

  return {
    controller,
    project: projectFixture(),
    character: options.character ?? null,
    uploadReferenceImage:
      options.uploadReferenceImage ??
      vi.fn(() => Promise.reject(new Error('媒体上传服务尚未装配'))),
    confirmCharacterTemplate: async (nodeId, selectedImageUrl) => {
      await controller.confirmCharacterTemplate(nodeId, selectedImageUrl, 'character-1')
      return options.character ?? characterFixture()
    },
    publishReviewedAction:
      options.publishReviewedAction ?? (() => Promise.reject(new Error('资产发布未装配'))),
    subscribeErrors: () => () => undefined,
    dispose: () => controller.dispose(),
  }
}

function generationApisFixture(overrides: Partial<GenerationApis> = {}): GenerationApis {
  return {
    create: vi.fn(() =>
      Promise.reject(new Error('Generation 后端尚未实现')),
    ) as GenerationApis['create'],
    get: vi.fn(() => Promise.reject(new Error('Generation 后端尚未实现'))),
    subscribe: vi.fn(() => () => undefined),
    ...overrides,
  }
}

function latestFlowProps() {
  if (!flowProps.current) throw new Error('React Flow 尚未渲染')
  return flowProps.current as {
    nodes: TestCanvasNode[]
    edges: Array<Record<string, unknown>>
    nodesConnectable?: boolean
    edgesReconnectable?: boolean
    deleteKeyCode?: null
  } & Record<string, unknown>
}

function workflowFixture(): WorkflowRun {
  return {
    id: '42',
    projectId: '1',
    version: 3,
    storageStatus: 'active',
    nodes: [
      {
        id: 'character-setup',
        type: 'character-setup',
        status: 'active',
        phase: 'configuring',
        dependsOnNodeIds: [],
        generations: [],
        error: null,
        input: { prompt: '短发少年冒险家', referenceMedia: [] },
      },
      {
        id: 'character-template',
        type: 'character-template',
        status: 'locked',
        phase: 'ready',
        dependsOnNodeIds: ['character-setup'],
        generations: [],
        error: null,
        selectedImageUrl: null,
      },
    ],
  }
}

function completedTemplateWorkflow(id: string): WorkflowRun {
  return {
    id,
    projectId: '1',
    version: 3,
    storageStatus: 'active',
    nodes: [
      {
        id: 'character-setup',
        type: 'character-setup',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: [],
        generations: [],
        error: null,
        input: { prompt: '短发少年冒险家', referenceMedia: [] },
      },
      {
        id: 'character-template',
        type: 'character-template',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['character-setup'],
        generations: [],
        error: null,
        selectedImageUrl: `https://assets.windup.test/${id}.png`,
      },
    ],
  }
}

function reviewingActionWorkflow(...actionIds: string[]): WorkflowRun {
  const workflow = completedTemplateWorkflow('42')
  workflow.version = 7
  for (const actionId of actionIds.length > 0 ? actionIds : ['action-walk']) {
    workflow.nodes.push(
      {
        id: actionId,
        type: 'action-first-frame',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['character-template'],
        generations: [],
        error: null,
        input: {
          outfitId: 'day',
          name: '行走',
          type: 'walk',
          prompt: null,
          fps: 12,
        },
        selectedFirstFrameUrl: 'https://assets.windup.test/walk-01.png',
      },
      {
        id: `${actionId}:method`,
        type: 'action-generation-method',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: [actionId],
        generations: [],
        error: null,
        method: 'video-cropping',
      },
      {
        id: `${actionId}:full-frame`,
        type: 'action-full-frame',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: [`${actionId}:method`],
        generations: [{ taskId: `generation-${actionId}`, role: 'complete_animation' }],
        error: null,
      },
      {
        id: `${actionId}:review`,
        type: 'review',
        status: 'active',
        phase: 'reviewing',
        dependsOnNodeIds: [`${actionId}:full-frame`],
        generations: [],
        error: null,
      },
    )
  }
  return workflow
}

function failedTemplateWorkflow(): WorkflowRun {
  const workflow = completedTemplateWorkflow('42')
  workflow.nodes[1] = {
    id: 'character-template',
    type: 'character-template',
    status: 'failed',
    phase: 'generating',
    dependsOnNodeIds: ['character-setup'],
    generations: [{ taskId: 'failed-task', role: 'character_template' }],
    error: '候选生成失败',
    selectedImageUrl: null,
  }
  return workflow
}

function selectingTemplateWorkflow(version: number, taskId: string): WorkflowRun {
  const workflow = completedTemplateWorkflow('42')
  workflow.version = version
  workflow.nodes[1] = {
    id: 'character-template',
    type: 'character-template',
    status: 'active',
    phase: 'selecting',
    dependsOnNodeIds: ['character-setup'],
    generations: [{ taskId, role: 'character_template' }],
    error: null,
    selectedImageUrl: null,
  }
  return workflow
}

function generatingTemplateWorkflow(): WorkflowRun {
  const workflow = completedTemplateWorkflow('42')
  workflow.nodes[1] = {
    id: 'character-template',
    type: 'character-template',
    status: 'active',
    phase: 'generating',
    dependsOnNodeIds: ['character-setup'],
    generations: [{ taskId: 'in-flight-task', role: 'character_template' }],
    error: null,
    selectedImageUrl: null,
  }
  return workflow
}

function createGenerationRaceSession(
  oldRead: Deferred<Generation | null>,
  latestRead: Deferred<Generation | null>,
): WorkflowEditorSession {
  const first = selectingTemplateWorkflow(3, 'old-task')
  const latest = selectingTemplateWorkflow(4, 'new-task')
  let listener: ((workflow: WorkflowRun) => void) | null = null
  let readCount = 0
  const controller = {
    getWorkflow: () => structuredClone(latest),
    subscribe(nextListener: (workflow: WorkflowRun) => void) {
      listener = nextListener
      nextListener(structuredClone(first))
      return () => {
        listener = null
      }
    },
    async resume() {
      listener?.(structuredClone(latest))
    },
    getGeneration: vi.fn(() => {
      readCount += 1
      return readCount === 1 ? oldRead.promise : latestRead.promise
    }),
    dispose: vi.fn(),
  } as unknown as WorkflowController

  return {
    controller,
    project: projectFixture(),
    character: null,
    uploadReferenceImage: vi.fn(() => Promise.reject(new Error('媒体上传服务尚未装配'))),
    confirmCharacterTemplate: vi.fn(async () => characterFixture()),
    publishReviewedAction: vi.fn(async () => Promise.reject(new Error('资产发布未装配'))),
    subscribeErrors: () => () => undefined,
    dispose: () => controller.dispose(),
  }
}

function createRestartSelectionSession(options: { status?: Generation['status'] } = {}): {
  session: WorkflowEditorSession
  emit(workflow: WorkflowRun): void
} {
  let current = selectingTemplateWorkflow(3, 'old-task')
  let listener: ((workflow: WorkflowRun) => void) | null = null
  const emit = (workflow: WorkflowRun) => {
    current = structuredClone(workflow)
    listener?.(structuredClone(current))
  }
  const controller = {
    getWorkflow: () => structuredClone(current),
    subscribe(nextListener: (workflow: WorkflowRun) => void) {
      listener = nextListener
      nextListener(structuredClone(current))
      return () => {
        listener = null
      }
    },
    resume: vi.fn(async () => undefined),
    getGeneration: vi.fn(async () => {
      const taskId = current.nodes[1]?.generations[0]?.taskId
      if (!taskId) return null
      const generation = characterGeneration(taskId.startsWith('new') ? 'new' : 'old')
      return options.status ? { ...generation, status: options.status } : generation
    }),
    restartFromNode: vi.fn(async () => {
      const ready = completedTemplateWorkflow('42')
      ready.version = current.version + 1
      ready.nodes[1] = {
        id: 'character-template',
        type: 'character-template',
        status: 'active',
        phase: 'ready',
        dependsOnNodeIds: ['character-setup'],
        generations: [],
        error: null,
        selectedImageUrl: null,
      }
      emit(ready)
    }),
    confirmCharacterTemplate: vi.fn(async () => undefined),
    dispose: vi.fn(),
  } as unknown as WorkflowController

  return {
    session: {
      controller,
      project: projectFixture(),
      character: null,
      uploadReferenceImage: vi.fn(() => Promise.reject(new Error('媒体上传服务尚未装配'))),
      confirmCharacterTemplate: vi.fn(async () => characterFixture()),
      publishReviewedAction: vi.fn(async () => Promise.reject(new Error('资产发布未装配'))),
      subscribeErrors: () => () => undefined,
      dispose: () => controller.dispose(),
    },
    emit,
  }
}

function characterGeneration(label: string): Generation {
  return {
    id: `${label}-task`,
    projectId: '1',
    type: 'character_template',
    status: 'completed',
    result: {
      type: 'character_template',
      images: [{ url: `https://assets.windup.test/${label}.png` }],
    },
    error: null,
  }
}

function completeAnimationGeneration(): Generation<'complete_animation'> {
  return {
    id: 'generation-walk',
    projectId: '1',
    type: 'complete_animation',
    status: 'completed',
    result: {
      type: 'complete_animation',
      frames: [
        { index: 0, url: 'https://assets.windup.test/walk-01.png', durationMs: 100 },
        { index: 1, url: 'https://assets.windup.test/walk-02.png', durationMs: null },
      ],
    },
    error: null,
  }
}

function characterFixture(): Character {
  return {
    id: '9',
    projectId: '1',
    workflowRunId: '42',
    name: '正式角色',
    description: null,
    referenceImageUrl: null,
    dataVersion: 1,
    status: 1,
    outfits: [
      {
        id: 'day',
        characterId: '9',
        name: '常态装',
        description: null,
        previewUrl: null,
        actions: [],
      },
      {
        id: 'night',
        characterId: '9',
        name: '夜行装',
        description: null,
        previewUrl: null,
        actions: [],
      },
    ],
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function projectFixture(): Project {
  return {
    id: '1',
    workflowId: null,
    name: '正式项目',
    perspective: 'side',
    directionalMovement: 'single',
    spriteSize: { width: 64, height: 64 },
    gameStyle: null,
    sampleImageUrl: null,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  }
}
