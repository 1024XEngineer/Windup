import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QuickStartCandidate, QuickStartEntryService, QuickStartSession } from './service'
import { WorkflowRunConflictError, type WorkflowRun } from '@/entities'
import { ApiError } from '@/shared/api'
import type { ExportPackageModel } from '@/features/export-package'
import { readActiveRun, rememberActiveRun } from '@/features/active-run'
import type {
  CreateQuickStartAgentOptions,
  PlannerInput,
  PlannerResult,
} from '@/features/quick-start-agent'
import { QuickStartPage } from './index'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.useRealTimers()
})

function workflow(nodes: WorkflowRun['nodes'], id = 'run-1'): WorkflowRun {
  return { id, projectId: 'project-1', version: 1, storageStatus: 'active', nodes }
}

function setupAndTemplate(
  template: Partial<Extract<WorkflowRun['nodes'][number], { type: 'character-template' }>> = {},
): WorkflowRun['nodes'] {
  return [
    {
      id: 'character-setup',
      type: 'character-setup',
      status: 'passed',
      phase: 'completed',
      dependsOnNodeIds: [],
      generations: [],
      error: null,
      input: { characterId: 'character-1', prompt: '像素骑士', referenceMedia: [] },
    },
    {
      id: 'character-template',
      type: 'character-template',
      status: 'active',
      phase: 'selecting',
      dependsOnNodeIds: ['character-setup'],
      generations: [{ taskId: 'template-task', role: 'character_template' }],
      error: null,
      selectedImageUrl: null,
      ...template,
    },
  ]
}

function actionWorkflow(
  options: {
    firstStatus?: 'active' | 'passed' | 'failed'
    firstPhase?: 'generating' | 'selecting' | 'completed'
    fullStatus?: 'locked' | 'active' | 'passed' | 'failed'
    reviewStatus?: 'locked' | 'active' | 'passed'
    error?: string | null
  } = {},
) {
  const firstStatus = options.firstStatus ?? 'passed'
  const fullStatus = options.fullStatus ?? 'locked'
  return workflow([
    ...setupAndTemplate({ status: 'passed', phase: 'completed', selectedImageUrl: 'template.png' }),
    {
      id: 'action-first',
      type: 'action-first-frame',
      status: firstStatus,
      phase: options.firstPhase ?? (firstStatus === 'passed' ? 'completed' : 'selecting'),
      dependsOnNodeIds: ['character-template'],
      generations: [{ taskId: 'first-task', role: 'first_frame' }],
      error: firstStatus === 'failed' ? (options.error ?? '首帧失败') : null,
      input: { outfitId: 'outfit-1', name: '挥手', type: 'custom', prompt: '挥手', fps: 12 },
      selectedFirstFrameUrl: firstStatus === 'passed' ? 'first.png' : null,
    },
    {
      id: 'method',
      type: 'action-generation-method',
      status: firstStatus === 'passed' ? 'passed' : 'locked',
      phase: firstStatus === 'passed' ? 'completed' : 'selecting',
      dependsOnNodeIds: ['action-first'],
      generations: [],
      error: null,
      method: firstStatus === 'passed' ? 'video-cropping' : null,
    },
    {
      id: 'action-full',
      type: 'action-full-frame',
      status: fullStatus,
      phase:
        fullStatus === 'passed' ? 'completed' : fullStatus === 'active' ? 'generating' : 'ready',
      dependsOnNodeIds: ['method'],
      generations:
        fullStatus === 'locked' ? [] : [{ taskId: 'full-task', role: 'complete_animation' }],
      error: fullStatus === 'failed' ? (options.error ?? '完整动作失败') : null,
    },
    {
      id: 'review',
      type: 'review',
      status: options.reviewStatus ?? 'locked',
      phase: options.reviewStatus === 'passed' ? 'completed' : 'reviewing',
      dependsOnNodeIds: ['action-full'],
      generations: [],
      error: null,
    },
  ])
}

type QuickStartMock = QuickStartEntryService & QuickStartSession

function serviceFor(run: WorkflowRun | null, overrides: Partial<QuickStartMock> = {}) {
  const fallbackRun = run ?? workflow(setupAndTemplate(), 'run-new')
  const service: QuickStartMock = {
    unavailableReason: null,
    runId: fallbackRun.id,
    start: vi.fn(async () => service),
    startWithUploadedTemplate: vi.fn(async () => service),
    open: vi.fn(async () => {
      if (!run) throw new Error('not found')
      return service
    }),
    continueWithUploadedTemplate: vi.fn(async () => run!),
    addAction: vi.fn(async () => fallbackRun),
    getWorkflow: vi.fn(() => fallbackRun),
    subscribe: vi.fn(() => () => undefined),
    subscribeErrors: vi.fn(() => () => undefined),
    resume: vi.fn(async () => fallbackRun),
    interrupt: vi.fn(async () => fallbackRun),
    dispose: vi.fn(),
    confirmCandidate: vi.fn(async () => fallbackRun),
    getFirstFrameCandidates: vi.fn(async () => []),
    getFailedGenerationDirections: vi.fn(async () => []),
    retryGenerationDirection: vi.fn(async () => fallbackRun),
    getWorkflowAgentContext: vi.fn(() => ({
      availableTools: fallbackRun.nodes.some(
        (node) =>
          node.type === 'character-template' &&
          node.status === 'passed' &&
          node.phase === 'completed',
      )
        ? ([
            'regenerate_character_template',
            'refine_character_template',
            'regenerate_first_frame',
            'refine_first_frame',
          ] as const)
        : [],
    })),
    regenerateCharacterTemplate: vi.fn(async () => fallbackRun),
    regenerateFirstFrame: vi.fn(async () => fallbackRun),
    confirmFirstFrame: vi.fn(async () => fallbackRun),
    approveReview: vi.fn(async () => fallbackRun),
    getCharacterInfo: vi.fn(() => ({ characterId: 'character-1', outfitId: 'outfit-1' })),
    resolveCharacterInfo: vi.fn(async () => ({ characterId: 'character-1', outfitId: 'outfit-1' })),
    getTemplateCandidates: vi.fn(async () => []),
    getActionFrames: vi.fn(async () => []),
    getExportModel: vi.fn(async () => null),
    ...overrides,
  }
  Object.assign(service, overrides)
  return service
}

describe('Quick Start workflow Agent', () => {
  it('routes a completed-run refinement through the current Controller session', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const planner = vi.fn(async () => ({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolName: 'refine_character_template',
          input: { adjustmentPrompt: '把披风改成深蓝色' },
        },
      ],
    }))
    const service = serviceFor(run)
    renderAt(`/quick-start/${run.id}`, service, agentFor({ planner }))

    const composer = await screen.findByRole('textbox', { name: '继续描述你的想法' })
    fireEvent.change(composer, { target: { value: '把披风改成深蓝色' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() =>
      expect(service.regenerateCharacterTemplate).toHaveBeenCalledWith(
        'refine',
        '把披风改成深蓝色',
      ),
    )
    const workflowPrompt = screen.getByText('像素骑士')
    const refinementTurn = screen.getByText('把披风改成深蓝色')
    expect(
      workflowPrompt.compareDocumentPosition(refinementTurn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(await screen.findByText('已提交角色母版微调。')).toBeTruthy()
  })

  it('keeps the conversation input disabled while a generation node is active', async () => {
    const run = actionWorkflow({
      firstStatus: 'passed',
      fullStatus: 'active',
      reviewStatus: 'locked',
    })
    const planner = vi.fn()
    const service = serviceFor(run)
    renderAt(`/quick-start/${run.id}`, service, agentFor({ planner }))

    const composer = await screen.findByRole('textbox', { name: '继续描述你的想法' })
    expect((composer as HTMLInputElement).disabled).toBe(true)
    expect(planner).not.toHaveBeenCalled()
  })

  it('keeps persisted workflow Agent turns after the generated results on refresh', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    window.localStorage.setItem(
      `windup.quick-start.agent-chat.v2:run:7:${run.id}`,
      JSON.stringify({
        turns: [
          { role: 'user', content: '银发骑士' },
          { role: 'user', content: '把披风改成深蓝色', scope: 'workflow' },
          {
            role: 'assistant',
            content: '已提交角色母版微调。',
            kind: 'reply',
            scope: 'workflow',
          },
        ],
      }),
    )

    renderAt(`/quick-start/${run.id}`, serviceFor(run))

    const workflowPrompt = await screen.findByText('像素骑士')
    const refinementTurn = screen.getByText('把披风改成深蓝色')
    expect(
      workflowPrompt.compareDocumentPosition(refinementTurn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByText('已提交角色母版微调。')).toBeTruthy()
  })
})

function eastCandidates(...imageUrls: string[]): readonly QuickStartCandidate[] {
  return imageUrls.map((imageUrl, index) => ({ direction: 'east', index, imageUrl }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function agentFor(
  overrides: Partial<CreateQuickStartAgentOptions> = {},
): CreateQuickStartAgentOptions {
  return {
    planner: vi.fn(async ({ messages }) => ({
      text: '',
      finishReason: 'tool-calls',
      toolCalls: [
        {
          toolName: 'start_character_generation',
          input: {
            optimizedPrompt: messages.at(-1)?.content ?? '',
            optimizationSummary: '我会保留角色的核心特征，并整理成适合母版生成的完整描述。',
          },
        },
      ],
    })),
    startCharacterGeneration: vi.fn(async () => ({ runId: 'run-new' })),
    ...overrides,
  }
}

function renderAt(
  path: string,
  service: QuickStartEntryService,
  agent: CreateQuickStartAgentOptions = agentFor(),
) {
  function PlaytestLocation() {
    const location = useLocation()
    return <h1>{`${location.pathname}${location.search}`}</h1>
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/quick-start"
          element={<QuickStartPage service={service} activeRunUserId="7" agent={agent} />}
        />
        <Route
          path="/quick-start/:runId"
          element={<QuickStartPage service={service} activeRunUserId="7" agent={agent} />}
        />
        <Route path="/projects/:projectId/assets" element={<PlaytestLocation />} />
        <Route path="/playtest/:characterId/:outfitId" element={<PlaytestLocation />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderInBrowserHistory(
  service: QuickStartEntryService,
  agent: CreateQuickStartAgentOptions = agentFor(),
) {
  return render(
    <BrowserRouter>
      <Routes>
        <Route
          path="/quick-start"
          element={<QuickStartPage service={service} activeRunUserId="7" agent={agent} />}
        />
      </Routes>
    </BrowserRouter>,
  )
}

async function confirmAgentGeneration() {
  const fill = await screen.findByRole('button', { name: '填入输入框' })
  fireEvent.click(fill)
  const send = await screen.findByRole('button', { name: '发送生成' })
  fireEvent.click(send)
  await act(async () => undefined)
}

function renderWithRunSwitcher(
  service: QuickStartEntryService,
  initialRunId: string,
  nextRunId: string,
) {
  const agent = agentFor()
  function Controls() {
    const navigate = useNavigate()
    const location = useLocation()
    return (
      <>
        <button type="button" onClick={() => navigate(`/quick-start/${nextRunId}`)}>
          切换当前运行
        </button>
        <output aria-label="当前位置">{location.pathname}</output>
      </>
    )
  }

  return render(
    <MemoryRouter initialEntries={[`/quick-start/${initialRunId}`]}>
      <Controls />
      <Routes>
        <Route
          path="/quick-start/:runId"
          element={<QuickStartPage service={service} activeRunUserId="7" agent={agent} />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

function renderStateFixture(
  state:
    | 'template-generating'
    | 'template-selecting'
    | 'first-generating'
    | 'first-selecting'
    | 'action-generating'
    | 'complete',
) {
  const candidateUrls = [
    'https://example.test/character-1.png',
    'https://example.test/character-2.png',
  ]
  const firstFrames = candidateUrls.map((_, index) => ({
    direction: 'east' as const,
    index,
    imageUrl: `https://example.test/first-${index + 1}.png`,
    durationMs: 80,
  }))
  const actionFrames = Array.from({ length: 8 }, (_, index) => ({
    index,
    imageUrl: `https://example.test/action-${index + 1}.png`,
    durationMs: 80,
  }))

  if (state === 'template-generating') {
    return renderAt(
      '/quick-start/run-1',
      serviceFor(workflow(setupAndTemplate({ phase: 'generating' }))),
    )
  }
  if (state === 'template-selecting') {
    const run = workflow(setupAndTemplate())
    return renderAt(
      '/quick-start/run-1',
      serviceFor(run, {
        getTemplateCandidates: vi.fn(async () => eastCandidates(...candidateUrls)),
      }),
    )
  }
  if (state === 'first-generating') {
    return renderAt(
      '/quick-start/run-1',
      serviceFor(actionWorkflow({ firstStatus: 'active', firstPhase: 'generating' })),
    )
  }
  if (state === 'first-selecting') {
    const run = actionWorkflow({ firstStatus: 'active', firstPhase: 'selecting' })
    return renderAt(
      '/quick-start/run-1',
      serviceFor(run, { getFirstFrameCandidates: vi.fn(async () => firstFrames) }),
    )
  }
  if (state === 'action-generating') {
    return renderAt('/quick-start/run-1', serviceFor(actionWorkflow({ fullStatus: 'active' })))
  }
  const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
  return renderAt(
    '/quick-start/run-1',
    serviceFor(run, { getActionFrames: vi.fn(async () => actionFrames) }),
  )
}

describe('QuickStartPage', () => {
  it('keeps the main export capability available in the conversation UI', async () => {
    const run = workflow(setupAndTemplate({ selectedImageUrl: '/master.png' }))
    const model: ExportPackageModel = {
      stage: 'character',
      characterId: 'character-1',
      characterName: '像素骑士',
      characterImageUrl: '/master.png',
      outfitId: 'outfit-1',
      outfitName: '默认造型',
      canvas: { width: 32, height: 40 },
      source: { workflowRunId: run.id, generationIds: [] },
      firstFrames: [],
      actions: [],
      playtest: null,
    }
    renderAt('/quick-start/run-1', serviceFor(run, { getExportModel: vi.fn(async () => model) }))

    expect(await screen.findByRole('button', { name: '导出角色母版' })).toBeTruthy()
  })

  it('renders real Chat History actions as SVG controls with accessible tooltips', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const exportModel: ExportPackageModel = {
      stage: 'action-assets',
      characterId: 'character-1',
      characterName: '像素骑士',
      characterImageUrl: '/master.png',
      outfitId: 'outfit-1',
      outfitName: '默认造型',
      canvas: { width: 32, height: 40 },
      source: { workflowRunId: run.id, generationIds: [] },
      firstFrames: [],
      actions: [],
      playtest: null,
    }
    renderAt(
      `/quick-start/${run.id}`,
      serviceFor(run, { getExportModel: vi.fn(async () => exportModel) }),
    )

    const actions = await Promise.all(
      ['复制提示词', '导出完整动作资产', '新建一次创作', '发送'].map((name) =>
        screen.findByRole('button', { name }),
      ),
    )
    expect(actions.every((button) => button.querySelector('svg'))).toBe(true)
    expect(actions.every((button) => button.querySelector('[role="tooltip"]'))).toBe(true)

    fireEvent.click(actions[0]!)
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('像素骑士'))
  })

  it('reserves the fixed app header height before the creation entry', () => {
    const entry = renderAt('/quick-start', serviceFor(null))
    const entrySection = entry.getByLabelText('创作指令').closest('section')

    expect(entrySection?.className).toContain('min-h-[100dvh]')
    expect(entrySection?.className).toContain('pt-14')
  })

  it('exposes the creation entry as a shared route-motion region', () => {
    renderAt('/quick-start', serviceFor(null))

    expect(screen.getByRole('region', { name: '创作入口' })).toBeTruthy()
  })

  it('keeps the creation entry on the app canvas without a second page frame', () => {
    renderAt('/quick-start', serviceFor(null))

    const entry = screen.getByRole('region', { name: '创作入口' })
    expect(entry.className).not.toContain('border-app-line')
    expect(entry.className).not.toContain('shadow-app-page')
  })

  it('uses a centered creation desk with style prompts before the composer', () => {
    const entry = renderAt('/quick-start', serviceFor(null))
    const entrySection = entry.getByLabelText('创作指令').closest('section')
    const entryLayout = entrySection?.querySelector('[data-layout="quick-start-entry"]')
    const composer = entrySection?.querySelector('[data-layout="quick-start-composer"]')
    const starters = entrySection?.querySelector('[data-layout="quick-start-starters"]')

    expect(entryLayout?.className).toContain('min-h-[calc(100dvh-3.5rem)]')
    expect(entryLayout?.className).toContain('grid-rows-[1fr_auto]')
    expect(composer?.className).toContain('max-w-3xl')
    expect(composer?.querySelector('form')).toBeTruthy()
    expect(composer?.querySelector('form')?.className).toContain('sm:grid-cols-[1fr_auto_auto]')
    expect(starters).toBeTruthy()
    expect(
      Boolean(
        starters &&
        composer &&
        starters.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
  })

  it('removes non-actionable explanatory copy from the creation workspace', () => {
    renderAt('/quick-start', serviceFor(null))

    expect(screen.queryByText('QUICK START / CREATE CHARACTER')).toBeNull()
    expect(screen.queryByText(/用一句角色设定/u)).toBeNull()
    expect(screen.queryByText('AI 快捷创作')).toBeNull()
    expect(screen.queryByText('文字创建')).toBeNull()
    expect(screen.queryByText('角色图生成后仍需人工选择候选')).toBeNull()
  })

  it('reuses the shared subtitle exit-before-enter timing in the original heading', () => {
    vi.useFakeTimers()
    const entry = renderAt('/quick-start', serviceFor(null))
    const heading = screen.getByRole('heading', { name: '想做一个什么角色？' })
    const cycle = () => entry.container.querySelector<HTMLElement>('[data-copy-phase]')

    expect(entry.container.querySelector('[data-layout="quick-start-role-idea"]')).toBeNull()
    expect(heading.textContent).toBe('想做一个什么角色？')

    act(() => vi.advanceTimersByTime(2_399))
    expect(heading.textContent).toBe('想做一个什么角色？')

    act(() => vi.advanceTimersByTime(1))
    expect(cycle()?.dataset.copyPhase).toBe('exiting')
    expect(heading.textContent).toBe('想做一个什么角色？')

    act(() => vi.advanceTimersByTime(460))
    expect(cycle()?.dataset.copyPhase).toBe('entering')
    expect(heading.textContent).toBe('试试银色卷发、戴星形单片眼镜的裁缝')

    act(() => vi.advanceTimersByTime(4_200))
    expect(heading.textContent).toContain('长着鹿角、披苔藓斗篷的邮差')

    act(() => vi.advanceTimersByTime(4_200 * 7))
    expect(heading.textContent).toBe('试试银色卷发、戴星形单片眼镜的裁缝')
    expect(heading.textContent).not.toContain('想做一个什么角色？')
  })

  it('animates back to the persistent default heading while the user writes', () => {
    vi.useFakeTimers()
    const entry = renderAt('/quick-start', serviceFor(null))
    const heading = screen.getByRole('heading', { name: '想做一个什么角色？' })
    const cycle = () => entry.container.querySelector<HTMLElement>('[data-copy-phase]')

    act(() => vi.advanceTimersByTime(3_400))
    expect(heading.textContent).toContain('银色卷发、戴星形单片眼镜的裁缝')

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '戴银色面具的游侠' },
    })
    expect(cycle()?.dataset.copyMotionMode).toBe('characters')
    expect(cycle()?.dataset.copyPhase).toBe('exiting')
    expect(heading.textContent).toContain('银色卷发、戴星形单片眼镜的裁缝')

    act(() => vi.advanceTimersByTime(460))
    expect(cycle()?.dataset.copyPhase).toBe('entering')
    expect(heading.textContent).toBe('用文字塑造你的角色……')

    act(() => vi.advanceTimersByTime(10_000))
    expect(heading.textContent).toBe('用文字塑造你的角色……')
  })

  it('keeps style prompt space stable while dissolving the cards once creation begins', () => {
    const entry = renderAt('/quick-start', serviceFor(null))
    const entrySection = entry.getByLabelText('创作指令').closest('section')
    const starters = entrySection?.querySelector('[data-layout="quick-start-starters"]')

    expect(screen.getByRole('heading', { name: '想做一个什么角色？' })).toBeTruthy()
    expect(starters?.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /16-bit 日式 RPG/u })).toBeTruthy()
    expect(screen.getByRole('button', { name: /暗黑哥特像素/u })).toBeTruthy()
    expect(screen.getByRole('button', { name: /温暖手绘像素/u })).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '戴银色面具的游侠' },
    })
    expect(entrySection?.querySelector('[data-layout="quick-start-starters"]')).toBe(starters)
    expect(starters?.getAttribute('data-presence')).toBe('hidden')
    expect(starters?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('button', { name: /暗黑哥特像素/u })).toBeNull()
  })

  it('offers style prompts only, without the retired role-example shortcuts', () => {
    renderAt('/quick-start', serviceFor(null))

    // 入口只保留三张风格卡：角色样例会让人误以为这些形象是现成资产。
    expect(screen.queryByRole('button', { name: '像素守夜人' })).toBeNull()
    expect(screen.queryByRole('button', { name: '轻装信使' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /16-bit 日式 RPG/u }))
    expect((screen.getByRole('textbox', { name: '创作指令' }) as HTMLInputElement).value).toBe(
      '16-bit 日式 RPG 像素风，清晰轮廓，明亮配色',
    )
  })

  it('keeps the entry composer compact without a textarea baseline gap', () => {
    renderAt('/quick-start', serviceFor(null))
    const composer = screen.getByRole('textbox', { name: '创作指令' })
    const editingSurface = composer.closest('label')

    expect(composer.tagName).toBe('TEXTAREA')
    expect((composer as HTMLTextAreaElement).rows).toBe(1)
    expect(composer.className).toContain('min-h-10')
    expect(composer.className).toContain('[field-sizing:content]')
    expect(composer.className).toContain('block')
    expect(composer.className).toContain('px-4')
    expect(editingSurface?.className).toContain('ml-2')
    expect(editingSurface?.className).toContain('rounded-lg')
    expect(editingSurface?.className).not.toContain('bg-app-surface')
    expect(screen.getByRole('button', { name: '生成角色' }).className).toContain('self-end')
    expect(composer.closest('form')?.className).toContain(
      'focus-within:shadow-[var(--shadow-app-composer-focus)]',
    )
  })

  it('keeps browser form history out of the creation composer', () => {
    renderAt('/quick-start', serviceFor(null))
    const composer = screen.getByRole('textbox', { name: '创作指令' })

    expect(composer.getAttribute('autocomplete')).toBe('off')
    expect(composer.closest('form')?.getAttribute('autocomplete')).toBe('off')
  })

  it('keeps the entry and run canvases at least viewport height', async () => {
    const entry = renderAt('/quick-start', serviceFor(null))
    expect(entry.getByLabelText('创作指令').closest('section')?.className).toContain(
      'min-h-[100dvh]',
    )

    entry.unmount()
    const run = workflow(setupAndTemplate())
    const runView = renderAt('/quick-start/run-1', serviceFor(run))
    expect((await runView.findByTestId('quick-start-run')).closest('section')?.className).toContain(
      'min-h-screen',
    )
  })

  it('continues the creation desk instead of switching to a workflow dashboard', async () => {
    renderAt('/quick-start/run-1', serviceFor(workflow(setupAndTemplate())))

    const runLayout = await screen.findByTestId('quick-start-run')
    expect(runLayout.getAttribute('data-layout')).toBe('agent-shell')
    expect(runLayout.querySelector('[data-layout="quick-start-scroll-region"]')).toBeTruthy()
    expect(screen.getByTestId('quick-start-composer').getAttribute('data-position')).toBe(
      'floating',
    )
    expect(runLayout.querySelector('aside')).toBeNull()
    expect(screen.getByRole('textbox', { name: '继续描述你的想法' })).toBeTruthy()
    expect(screen.queryByText(/QUICK START \/ RUN/u)).toBeNull()
    expect(screen.queryByText('CURRENT STATUS')).toBeNull()
    expect(screen.queryByText('WORKFLOW RUN')).toBeNull()
    expect(screen.queryByText(/STEPS PASSED/u)).toBeNull()
    const continueButton = screen.getByRole('button', { name: '确认选择，继续下一步' })
    expect(continueButton.querySelector('svg')).toBeTruthy()
  })

  it('生成进行中时为 Header 留下返回入口，走完就清掉', async () => {
    renderStateFixture('template-generating')

    await waitFor(() => expect(readActiveRun('7')).toBe('run-1'))
  })

  it('生成结束后等待用户选择时仍保留返回入口', async () => {
    renderStateFixture('template-selecting')

    await screen.findByTestId('quick-start-transcript')
    expect(readActiveRun('7')).toBe('run-1')
  })

  it('reuses generation-copy typography and blur reveal for Agent replies without avatars', async () => {
    renderStateFixture('action-generating')

    const transcript = await screen.findByTestId('quick-start-transcript')
    const agentCopies = Array.from(transcript.querySelectorAll<HTMLElement>('[data-agent-copy]'))
    const standaloneAvatar = Array.from(transcript.querySelectorAll('span')).find(
      (element) => element.textContent === 'W',
    )

    expect(agentCopies.length).toBeGreaterThan(0)
    expect(
      agentCopies.every((copy) => {
        const motion = copy.querySelector<HTMLElement>('[data-copy-motion-mode="characters"]')
        return (
          copy.className.includes('font-serif') &&
          copy.className.includes('generation-progress-copy--conversation') &&
          motion &&
          !motion.className.includes('generation-progress-copy') &&
          copy.querySelectorAll('.kinetic-copy-character').length > 0 &&
          copy.querySelectorAll('[data-agent-character]').length === 0
        )
      }),
    ).toBe(true)
    expect(standaloneAvatar).toBeUndefined()
  })

  it('keeps an unbound Agent draft in its current Quick Start history entry', async () => {
    const service = serviceFor(null)
    const planner = vi.fn(async (_input: PlannerInput) => ({
      text: '可以。你最想保留哪个外观特征？',
      finishReason: 'stop',
      toolCalls: [],
    }))
    const agent = agentFor({ planner })
    window.history.replaceState(null, '', '/quick-start')
    const firstView = renderInBrowserHistory(service, agent)

    expect(screen.queryByText('MOCK 演示')).toBeNull()
    expect(screen.getByRole('textbox', { name: '创作指令' })).toBeTruthy()
    expect(window.sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(0)
    expect(window.history.state?.windupQuickStartAgentDraftId).toBeUndefined()

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '我想做一个住在云端的机械师。' },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))

    expect(await screen.findByText('我想做一个住在云端的机械师。')).toBeTruthy()
    expect(await screen.findByText('可以。你最想保留哪个外观特征？')).toBeTruthy()
    expect(planner).toHaveBeenCalledTimes(1)
    const draftId = window.history.state?.windupQuickStartAgentDraftId
    expect(draftId).toEqual(expect.any(String))
    const persistedAgentChat = window.sessionStorage.getItem(
      `windup.quick-start.agent-chat.v2:draft:7:${draftId}`,
    )
    expect(persistedAgentChat).toContain('我想做一个住在云端的机械师。')
    expect(persistedAgentChat).toContain('可以。你最想保留哪个外观特征？')
    expect(persistedAgentChat).not.toContain('勾勒角色轮廓')
    expect(window.localStorage.length).toBe(0)

    firstView.unmount()
    const restoredView = renderInBrowserHistory(service, agent)

    expect(screen.getByText('我想做一个住在云端的机械师。')).toBeTruthy()
    expect(screen.getByText('可以。你最想保留哪个外观特征？')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '刚才我说了什么？' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    await waitFor(() => expect(planner).toHaveBeenCalledTimes(2))
    expect(planner.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: '我想做一个住在云端的机械师。' },
      { role: 'assistant', content: '可以。你最想保留哪个外观特征？' },
      { role: 'user', content: '刚才我说了什么？' },
    ])

    restoredView.unmount()
    window.history.pushState(null, '', '/quick-start')
    renderInBrowserHistory(service, agent)

    expect(screen.queryByText('我想做一个住在云端的机械师。')).toBeNull()
    expect(screen.queryByText('可以。你最想保留哪个外观特征？')).toBeNull()
  })

  it('moves the Agent draft into a run-scoped sidecar when generation starts', async () => {
    vi.useFakeTimers()
    const createdRun = workflow(setupAndTemplate({ phase: 'generating' }), 'run-created')
    const service = serviceFor(createdRun, {
      runId: 'run-created',
      getWorkflow: vi.fn(() => createdRun),
      resume: vi.fn(async () => createdRun),
    })
    renderAt(
      '/quick-start',
      service,
      agentFor({
        startCharacterGeneration: vi.fn(async () => ({ runId: 'run-created' })),
      }),
    )

    fireEvent.change(screen.getByLabelText('创作指令'), {
      target: { value: '提着风灯的森林守夜人' },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    await act(async () => undefined)

    const draftId = window.history.state?.windupQuickStartAgentDraftId
    expect(draftId).toEqual(expect.any(String))
    expect(
      window.sessionStorage.getItem(`windup.quick-start.agent-chat.v2:draft:7:${draftId}`),
    ).toContain('提着风灯的森林守夜人')

    fireEvent.click(screen.getByRole('button', { name: '填入输入框' }))
    await act(async () => vi.advanceTimersByTimeAsync(760))
    fireEvent.change(screen.getByLabelText('创作指令'), {
      target: { value: '提着蓝色风灯的森林守夜人' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送生成' }))
    await act(async () => undefined)
    await act(async () => vi.advanceTimersByTime(460))

    const runConversation = window.localStorage.getItem(
      'windup.quick-start.agent-chat.v2:run:7:run-created',
    )
    expect(runConversation).toContain('提着蓝色风灯的森林守夜人')
    expect(
      window.sessionStorage.getItem(`windup.quick-start.agent-chat.v2:draft:7:${draftId}`),
    ).toBeNull()
  })

  it('loads Agent turns only from the matching run sidecar', async () => {
    window.localStorage.setItem(
      'windup.quick-start.agent-chat.v2:run:7:run-1',
      JSON.stringify({ turns: [{ role: 'user', content: '第一条运行的对话' }] }),
    )
    window.localStorage.setItem(
      'windup.quick-start.agent-chat.v2:run:7:run-2',
      JSON.stringify({ turns: [{ role: 'user', content: '第二条运行的对话' }] }),
    )
    window.localStorage.setItem(
      'windup.quick-start.agent-chat.v2:run:8:run-1',
      JSON.stringify({ turns: [{ role: 'user', content: '另一位用户的对话' }] }),
    )
    const run = workflow(setupAndTemplate(), 'run-1')

    renderAt('/quick-start/run-1', serviceFor(run))

    expect(await screen.findByText('第一条运行的对话')).toBeTruthy()
    expect(screen.queryByText('第二条运行的对话')).toBeNull()
    expect(screen.queryByText('另一位用户的对话')).toBeNull()
  })

  it('migrates only legacy Agent turns bound to the current run', async () => {
    const run = workflow(setupAndTemplate(), 'run-1')
    const legacyKey = 'windup.quick-start.agent-chat.v1:7'
    window.localStorage.setItem(
      legacyKey,
      JSON.stringify({ runId: null, turns: [{ role: 'user', content: '旧版未绑定草稿' }] }),
    )

    const unboundView = renderAt('/quick-start/run-1', serviceFor(run))

    expect(screen.queryByText('旧版未绑定草稿')).toBeNull()
    expect(window.localStorage.getItem(legacyKey)).toContain('旧版未绑定草稿')

    unboundView.unmount()
    window.localStorage.setItem(
      legacyKey,
      JSON.stringify({ runId: 'run-1', turns: [{ role: 'user', content: '旧版运行对话' }] }),
    )
    renderAt('/quick-start/run-1', serviceFor(run))

    expect(await screen.findByText('旧版运行对话')).toBeTruthy()
    expect(window.localStorage.getItem('windup.quick-start.agent-chat.v2:run:7:run-1')).toContain(
      '旧版运行对话',
    )
    expect(window.localStorage.getItem(legacyKey)).toBeNull()
  })

  it('keeps the proposal in chat until the user fills, edits, and sends it', async () => {
    vi.useFakeTimers()
    const service = serviceFor(null)
    const startCharacterGeneration = vi.fn(() => new Promise<{ runId: string }>(() => undefined))
    const agent = agentFor({ startCharacterGeneration })
    renderAt('/quick-start', service, agent)

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '云端工坊的银发机械师' },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    await act(async () => undefined)

    const composer = screen.getByTestId('quick-start-composer')
    const input = screen.getByRole('textbox', { name: '创作指令' }) as HTMLTextAreaElement
    expect(input.tagName).toBe('TEXTAREA')
    expect(input.rows).toBe(1)
    expect(input.className).toContain('[field-sizing:content]')
    expect(input.value).toBe('')
    expect(
      screen.getByText('我会保留角色的核心特征，并整理成适合母版生成的完整描述。'),
    ).toBeTruthy()
    expect(screen.getAllByText('云端工坊的银发机械师')).toHaveLength(2)
    expect(screen.queryByText(/默认处理|Tool|确认后点击发送/u)).toBeNull()
    expect(startCharacterGeneration).not.toHaveBeenCalled()

    const proposal = screen
      .getAllByText('云端工坊的银发机械师')
      .find((element) => element.tagName === 'BLOCKQUOTE')
      ?.closest('[data-prompt-proposal]')
    const optimizedCopy = proposal?.querySelector('blockquote')
    expect(optimizedCopy?.className).not.toContain('border-l')
    expect(optimizedCopy?.className).not.toContain('pl-4')
    const fill = screen.getByRole('button', { name: '填入输入框' })
    expect(fill.className).not.toContain('border')
    expect(fill.textContent).toContain('填入输入框后，还可以继续修改')
    fireEvent.click(fill)

    expect(composer.dataset.promptState).toBe('rewriting')
    const promptRewrite = composer.querySelector('[data-prompt-rewrite]')
    expect(promptRewrite?.querySelector('[data-copy-motion-mode="characters"]')).toBeTruthy()
    expect(promptRewrite?.querySelectorAll('.kinetic-copy-character').length).toBeGreaterThan(0)
    expect(startCharacterGeneration).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTimeAsync(760))
    expect(composer.dataset.promptState).toBe('ready')
    expect(input.value).toBe('云端工坊的银发机械师')
    expect(input.hasAttribute('readonly')).toBe(false)
    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '发送生成' }).hasAttribute('disabled')).toBe(true)
    expect(startCharacterGeneration).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '云端工坊的银发机械师，佩戴黄铜护目镜' } })
    expect(screen.getByRole('button', { name: '发送生成' })).toBeTruthy()
    expect(startCharacterGeneration).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '发送生成' }))
    await act(async () => undefined)
    expect(startCharacterGeneration).toHaveBeenCalledWith({
      prompt: '云端工坊的银发机械师，佩戴黄铜护目镜',
      directionalMovement: 'single',
    })
  })

  it('keeps a proposal optional when the user continues the conversation', async () => {
    const plannerResults: PlannerResult[] = [
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolName: 'start_character_generation',
            input: {
              optimizedPrompt: '云端工坊的银发机械师，全身像',
              optimizationSummary: '我会保留机械师设定，并整理为完整的全身母版描述。',
            },
          },
        ],
      },
      { text: '可以先比较护目镜和单片镜两种方向。', finishReason: 'stop', toolCalls: [] },
    ]
    const planner = vi.fn(async () => plannerResults.shift()!)
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-should-not-exist' }))
    renderAt('/quick-start', serviceFor(null), { planner, startCharacterGeneration })

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '云端工坊的银发机械师' },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    expect(await screen.findByRole('button', { name: '填入输入框' })).toBeTruthy()

    const input = screen.getByRole('textbox', { name: '创作指令' }) as HTMLTextAreaElement
    expect(input.disabled).toBe(false)
    fireEvent.change(input, { target: { value: '你觉得眼镜应该怎么设计？' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))

    expect(await screen.findByText('可以先比较护目镜和单片镜两种方向。')).toBeTruthy()
    expect(startCharacterGeneration).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '填入输入框' })).toBeNull()
  })

  it('keeps one persistent Agent shell with a floating composer outside the scrolling transcript', async () => {
    renderStateFixture('first-selecting')

    const runLayout = await screen.findByTestId('quick-start-run')
    const transcript = await screen.findByTestId('quick-start-transcript')
    const composer = screen.getByTestId('quick-start-composer')
    const scrollRegion = transcript.closest('[data-layout="quick-start-scroll-region"]')
    const agentTurns = Array.from(transcript.querySelectorAll<HTMLElement>('[data-agent-turn]'))
    const userTurns = Array.from(transcript.querySelectorAll<HTMLElement>('[data-user-turn]'))

    expect(runLayout.getAttribute('data-layout')).toBe('agent-shell')
    expect(scrollRegion).toBeTruthy()
    expect(scrollRegion?.contains(composer)).toBe(false)
    expect(composer.getAttribute('data-position')).toBe('floating')
    expect(composer.className).toContain('absolute')
    expect(agentTurns.length).toBeGreaterThanOrEqual(2)
    expect(userTurns.length).toBeGreaterThanOrEqual(2)
    expect(userTurns.every((turn) => turn.className.includes('w-fit'))).toBe(true)
    expect(transcript.querySelector('[data-agent-identity]')).toBeNull()
  })

  it('keeps the composer shape stable while generation can be interrupted', async () => {
    renderStateFixture('action-generating')

    const composer = await screen.findByTestId('quick-start-composer')
    const interrupt = screen.getByRole('button', { name: '中断自动制作' })

    expect(composer).toBeTruthy()
    expect(interrupt.querySelector('svg')).toBeTruthy()
    expect(interrupt.hasAttribute('disabled')).toBe(false)
  })

  it('scrolls only the transcript region when new Agent output arrives', async () => {
    const scrollTo = vi.fn()
    const scrollIntoView = vi.fn()
    const previousScrollTo = HTMLElement.prototype.scrollTo
    const previousScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollTo = scrollTo
    HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      renderStateFixture('template-selecting')
      await screen.findAllByRole('button', { name: /选择角色方案/u })

      expect(scrollTo).toHaveBeenCalled()
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.scrollTo = previousScrollTo
      HTMLElement.prototype.scrollIntoView = previousScrollIntoView
    }
  })

  it('keeps each generated artifact inside the Agent turn that describes it', async () => {
    renderStateFixture('template-selecting')

    const transcript = await screen.findByTestId('quick-start-transcript')
    await screen.findAllByRole('button', { name: /选择角色方案/u })
    const roleTurn = transcript.querySelector<HTMLElement>('[data-agent-turn="character-template"]')
    const choices = Array.from(roleTurn?.querySelectorAll('[data-asset-choice="true"]') ?? [])

    expect(roleTurn).toBeTruthy()
    expect(roleTurn?.querySelector('[data-agent-identity]')).toBeNull()
    expect(roleTurn?.querySelector('[data-agent-copy]')).toBeTruthy()
    expect(choices).toHaveLength(2)
    expect(
      Array.from(transcript.querySelectorAll('[data-asset-choice="true"]')).every((asset) =>
        Boolean(asset.closest('[data-agent-turn]')),
      ),
    ).toBe(true)
  })

  it.each([
    ['template-generating', '角色图生成画布'],
    ['first-generating', '动作首帧生成画布'],
    ['action-generating', '完整动作生成画布'],
  ] as const)(
    'reserves an animated dot-matrix canvas while %s is generating',
    async (state, label) => {
      renderStateFixture(state)

      const canvas = await screen.findByRole('img', { name: label })
      expect(canvas.getAttribute('data-generation-preview')).toBe('true')
      expect(canvas.getAttribute('data-generation-preview-size')).toBe('candidate')
      expect(canvas.getAttribute('data-generation-preview-radius')).toBe('output')
      expect(canvas.getAttribute('data-generation-state')).toBe('generating')
      expect(canvas.getAttribute('data-generation-motion')).toBe('continuous')
      expect(canvas.querySelectorAll('[data-pixel-matrix-dot]')).toHaveLength(432)
      expect(canvas.querySelector('[data-generation-silhouette]')).toBeNull()
    },
  )

  it.each([
    [
      workflow(setupAndTemplate({ phase: 'generating' })),
      '角色生成进度',
      ['勾勒角色轮廓', '给衣服配颜色', '把发型画清楚', '添上表情', '处理一下光影', '补齐画面细节'],
    ],
    [
      actionWorkflow({ firstStatus: 'active', firstPhase: 'generating' }),
      '动作首帧生成进度',
      [
        '摆好动作姿态',
        '调整手脚位置',
        '让重心自然一点',
        '拉开姿态的区别',
        '保持角色样子',
        '补上动作细节',
      ],
    ],
    [
      actionWorkflow({ fullStatus: 'active' }),
      '完整动作生成进度',
      [
        '把动作连起来',
        '补上中间的变化',
        '理顺每一帧的节奏',
        '检查手脚的衔接',
        '让起落自然一点',
        '调整动作幅度',
      ],
    ],
  ] as const)('cycles generation companionship copy for $label', async (run, label, messages) => {
    vi.useFakeTimers()
    const view = renderAt('/quick-start/run-1', serviceFor(run))

    await act(async () => undefined)
    const progress = screen.getByLabelText(label)
    expect(progress.className).toContain('generation-progress-copy')
    expect(progress.getAttribute('data-copy-motion-mode')).toBe('characters')
    expect(progress.textContent).toBe(messages[0])
    expect(progress.getAttribute('data-copy-phase')).toBe('entering')

    await act(async () => vi.advanceTimersByTime(760))
    expect(progress.getAttribute('data-copy-phase')).toBe('resting')

    for (const [messageIndex, message] of messages.slice(1).entries()) {
      const timeUntilNextMessage = messageIndex === 0 ? 7_239 : 7_999
      await act(async () => vi.advanceTimersByTime(timeUntilNextMessage))
      expect(progress.textContent).not.toBe(message)
      await act(async () => vi.advanceTimersByTime(1))
      expect(progress.textContent).toBe(message)
    }

    await act(async () => vi.advanceTimersByTime(8_000))
    expect(progress.textContent).toBe(messages[0])

    expect(
      view.container.querySelector('[data-agent-turn][data-current-turn="true"] [data-agent-copy]'),
    ).toBeNull()
  })

  it('keeps selection and completed replies static instead of cycling subtitles', async () => {
    const selecting = renderStateFixture('template-selecting')
    await screen.findAllByRole('button', { name: /选择角色方案/u })
    expect(selecting.container.querySelector('[data-generation-progress]')).toBeNull()
    selecting.unmount()

    const complete = renderStateFixture('complete')
    await screen.findByRole('img', { name: '完整动作预览' })
    expect(complete.container.querySelector('[data-generation-progress]')).toBeNull()
  })

  it('animates only the completed action preview with the action fps fallback', async () => {
    vi.useFakeTimers()
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const service = serviceFor(run, {
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/action-1.png', durationMs: null },
        { index: 1, imageUrl: 'https://example.test/action-2.png', durationMs: null },
      ]),
    })
    renderAt('/quick-start/run-1', service)

    await act(async () => undefined)
    const preview = screen.getByRole('img', { name: '完整动作预览' })
    const firstThumbnail = screen.getByRole('img', { name: '动作第 1 帧' })
    expect(preview.getAttribute('src')).toBe('https://example.test/action-1.png')

    await act(async () => vi.advanceTimersByTime(82))
    expect(preview.getAttribute('src')).toBe('https://example.test/action-1.png')

    await act(async () => vi.advanceTimersByTime(1))
    expect(preview.getAttribute('src')).toBe('https://example.test/action-2.png')
    expect(firstThumbnail.getAttribute('src')).toBe('https://example.test/action-1.png')
  })

  it('reveals generated candidate frames with staggered motion', async () => {
    renderStateFixture('template-selecting')

    const cards = await screen.findAllByRole('button', { name: /选择角色方案/u })
    expect(cards).toHaveLength(2)
    expect(cards.every((card) => card.dataset.assetChoice === 'true')).toBe(true)
    expect(cards.every((card) => card.querySelectorAll('[data-asset-frame]').length === 1)).toBe(
      true,
    )
    expect(cards.every((card) => card.dataset.reveal === 'card')).toBe(true)
    expect(cards.map((card) => card.style.getPropertyValue('--reveal-index'))).toEqual(['0', '1'])
    expect(cards.every((card) => card.querySelector('img'))).toBeTruthy()
  })

  it('matches generated cards to the composer radius and keeps image surfaces free of labels', async () => {
    renderStateFixture('template-selecting')

    const cards = await screen.findAllByRole('button', { name: /选择角色方案/u })

    expect(cards.every((card) => card.className.includes('rounded-2xl'))).toBe(true)
    expect(cards.every((card) => card.textContent === '')).toBe(true)
  })

  it('keeps equal candidate frames at the same size as confirmed assets', async () => {
    renderStateFixture('template-selecting')

    const choices = await screen.findAllByRole('button', { name: /选择角色方案/u })
    const resultLayout = choices[0]?.parentElement

    expect(resultLayout?.getAttribute('data-layout')).toBe('agent-result-set')
    expect(resultLayout?.className).toContain('grid-cols-3')
    expect(choices.every((choice) => choice.getAttribute('data-result-priority') === null)).toBe(
      true,
    )
    expect(choices.every((choice) => !choice.className.includes('row-span-2'))).toBe(true)
  })

  it.each([
    ['template-generating', '角色图生成画布', 'grid-cols-3'],
    ['first-selecting', '动作首帧候选 1', 'grid-cols-3'],
    ['complete', '完整动作预览', 'grid-cols-3'],
  ] as const)('keeps %s on the first-round asset frame grid', async (state, label, columns) => {
    const view = renderStateFixture(state)
    const asset = await screen.findByRole('img', { name: label })
    const frameGrid = asset.closest('[data-layout="agent-result-set"]')

    expect(frameGrid?.className).toContain('max-w-2xl')
    expect(frameGrid?.className).toContain(columns)
    view.unmount()
  })

  it('grows a short conversation from the persistent composer and distinguishes the current turn', async () => {
    renderStateFixture('action-generating')

    const transcript = await screen.findByTestId('quick-start-transcript')
    const turns = Array.from(transcript.querySelectorAll<HTMLElement>('[data-agent-turn]'))

    expect(transcript.className).toContain('min-h-full')
    expect(transcript.className).toContain('content-end')
    expect(turns.slice(0, -1).every((turn) => turn.dataset.currentTurn === 'false')).toBe(true)
    expect(turns.at(-1)?.dataset.currentTurn).toBe('true')
  })

  it('keeps the Agent conversation visible while the run restore is pending', async () => {
    vi.useFakeTimers()
    const createdRun = workflow(setupAndTemplate({ phase: 'generating' }), 'run-created')
    const restoredSession = deferred<QuickStartSession>()
    const service = serviceFor(createdRun, {
      runId: 'run-created',
      open: vi.fn(() => restoredSession.promise),
      getWorkflow: vi.fn(() => createdRun),
      resume: vi.fn(async () => createdRun),
    })
    renderAt(
      '/quick-start',
      service,
      agentFor({
        startCharacterGeneration: vi.fn(async () => ({ runId: 'run-created' })),
      }),
    )

    fireEvent.change(screen.getByLabelText('创作指令'), {
      target: { value: '提着风灯的森林守夜人' },
    })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    await act(async () => undefined)
    expect(screen.getAllByText('提着风灯的森林守夜人')).toHaveLength(2)
    expect(screen.getByTestId('quick-start-composer').dataset.promptState).toBe('collecting')
    expect(screen.queryByTestId('quick-start-run')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '填入输入框' }))
    expect(screen.getByTestId('quick-start-composer').dataset.promptState).toBe('rewriting')
    await act(async () => vi.advanceTimersByTimeAsync(760))
    expect(screen.getByRole('button', { name: '发送生成' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '发送生成' }))
    await act(async () => undefined)

    const entry = screen.getByLabelText('创作指令').closest('[data-layout="quick-start-entry"]')
    expect(entry?.getAttribute('data-transition')).toBe('leaving')
    expect(screen.getByTestId('quick-start-transcript').textContent).toContain(
      '提着风灯的森林守夜人',
    )

    await act(async () => vi.advanceTimersByTime(459))
    expect(screen.queryByTestId('quick-start-run')).toBeNull()

    await act(async () => vi.advanceTimersByTime(1))
    const restoringTranscript = screen.getByTestId('quick-start-restoring-transcript')
    expect(restoringTranscript.textContent).toContain('提着风灯的森林守夜人')
    expect(screen.queryByText('正在恢复这次创作')).toBeNull()
    expect(screen.queryByText('正在读取工作流状态…')).toBeNull()

    expect(restoringTranscript.querySelector('[data-conversation-kind="agent"]')).toBeTruthy()
    expect(screen.getByTestId('quick-start-run').getAttribute('aria-busy')).toBe('true')
  })

  it('keeps earlier turns visible while the agent conversation moves downward', async () => {
    renderStateFixture('first-selecting')

    await screen.findByLabelText(/已生成 2 个动作起始姿态。 选择一个起始姿态，随后生成完整动作。/u)
    const transcript = await screen.findByTestId('quick-start-transcript')
    const topLevelText = Array.from(transcript.children).map(
      (element) =>
        element.querySelector('[data-agent-copy] [aria-label]')?.getAttribute('aria-label') ??
        element.textContent ??
        '',
    )
    const roleTurnIndex = topLevelText.findIndex((text) => text.includes('角色方案已确认'))
    const userActionIndex = topLevelText.findIndex((text) => text.includes('挥手'))
    const firstFrameTurnIndex = topLevelText.findIndex((text) =>
      text.includes('已生成 2 个动作起始姿态'),
    )
    expect(roleTurnIndex).toBeGreaterThanOrEqual(0)
    expect(roleTurnIndex).toBeLessThan(userActionIndex)
    expect(userActionIndex).toBeLessThan(firstFrameTurnIndex)
    expect(screen.getByRole('img', { name: '已选择的角色' })).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /动作首帧候选/u })).toHaveLength(2)
  })

  it('keeps the candidate selected until the action description is sent', async () => {
    vi.useFakeTimers()
    const selectingRun = workflow(setupAndTemplate())
    const nextRun = actionWorkflow({ firstStatus: 'active', firstPhase: 'generating' })
    const service = serviceFor(selectingRun, {
      getTemplateCandidates: vi.fn(async () =>
        eastCandidates(
          'https://example.test/character-1.png',
          'https://example.test/character-2.png',
          'https://example.test/character-3.png',
        ),
      ),
      confirmCandidate: vi.fn(async () => nextRun),
    })
    renderAt('/quick-start/run-1', service)

    await act(async () => undefined)
    const candidate = screen.getByRole('button', { name: /选择角色方案 2/u })
    fireEvent.click(candidate)
    await act(async () => undefined)

    expect(candidate.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('quick-start-transcript').textContent).not.toContain(
      '你选择了角色方案 2',
    )
    expect(screen.getByPlaceholderText('描述这个角色接下来要做的动作…')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '确认选择，继续下一步' }).hasAttribute('disabled'),
    ).toBe(false)

    fireEvent.change(screen.getByLabelText('继续描述你的想法'), {
      target: { value: '转身挥动风灯' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认选择，继续下一步' }))
    await act(async () => undefined)

    const transcript = screen.getByTestId('quick-start-transcript').textContent ?? ''
    expect(transcript).not.toContain('你选择了')
    expect(transcript).toContain('摆好动作姿态')
    expect(service.confirmCandidate).toHaveBeenCalledWith(
      { east: 'https://example.test/character-2.png' },
      '转身挥动风灯',
    )
  })

  it('四向角色候选全部选定后才提交逐方向选择', async () => {
    const selectingRun = workflow(setupAndTemplate())
    const directionalCandidates = [
      { direction: 'east', index: 0, imageUrl: 'east-1.png' },
      { direction: 'east', index: 1, imageUrl: 'east-2.png' },
      { direction: 'west', index: 0, imageUrl: 'west-1.png' },
      { direction: 'west', index: 1, imageUrl: 'west-2.png' },
      { direction: 'north', index: 0, imageUrl: 'north-1.png' },
      { direction: 'north', index: 1, imageUrl: 'north-2.png' },
      { direction: 'south', index: 0, imageUrl: 'south-1.png' },
      { direction: 'south', index: 1, imageUrl: 'south-2.png' },
    ] satisfies readonly QuickStartCandidate[]
    const service = serviceFor(selectingRun, {
      getTemplateCandidates: vi.fn(async () => directionalCandidates),
    })
    renderAt('/quick-start/run-1', service)

    const submit = await screen.findByRole('button', { name: '确认选择，继续下一步' })
    fireEvent.click(await screen.findByRole('button', { name: '选择东方向角色方案 2' }))
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '选择西方向角色方案 2' }))
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '选择北方向角色方案 1' }))
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '选择南方向角色方案 2' }))
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)

    await waitFor(() =>
      expect(service.confirmCandidate).toHaveBeenCalledWith(
        {
          east: 'east-2.png',
          west: 'west-2.png',
          north: 'north-1.png',
          south: 'south-2.png',
        },
        '',
      ),
    )
  })

  it('八向角色候选完整展示全部八个独立方向', async () => {
    const selectingRun = workflow(setupAndTemplate())
    const directions = [
      ['east', '东'],
      ['west', '西'],
      ['north', '北'],
      ['south', '南'],
      ['north_east', '东北'],
      ['north_west', '西北'],
      ['south_east', '东南'],
      ['south_west', '西南'],
    ] as const
    const service = serviceFor(selectingRun, {
      getTemplateCandidates: vi.fn(async () =>
        directions.map(([direction]) => ({
          direction,
          index: 0,
          imageUrl: `${direction}.png`,
        })),
      ),
    })
    renderAt('/quick-start/run-1', service)

    for (const [, label] of directions) {
      expect(await screen.findByRole('region', { name: `${label}方向角色方案候选` })).toBeTruthy()
    }
  })

  it('keeps the natural-language creation entry visible when no run is selected', () => {
    render(
      <MemoryRouter>
        <QuickStartPage service={serviceFor(null)} agent={agentFor()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('textbox', { name: '创作指令' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /16-bit 日式 RPG/u }))
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      '16-bit 日式 RPG 像素风，清晰轮廓，明亮配色',
    )
    expect(screen.queryByRole('button', { name: /暗黑哥特像素/u })).toBeNull()
  })

  it('asks once, then presents a user-facing proposal without internal assumptions', async () => {
    const action = deferred<{ runId: string }>()
    const plannerResults: PlannerResult[] = [
      { text: '请补充角色的美术风格。', finishReason: 'stop', toolCalls: [] },
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolName: 'start_character_generation',
            input: {
              optimizedPrompt: '银发骑士，16-bit 像素风，全身像',
              optimizationSummary:
                '我会保留银发骑士和 16-bit 风格，并整理为轮廓清楚的全身母版描述。',
            },
          },
        ],
      },
    ]
    const planner = vi.fn(async (_input: PlannerInput) => plannerResults.shift()!)
    const startCharacterGeneration = vi.fn(() => action.promise)
    renderAt('/quick-start', serviceFor(null), { planner, startCharacterGeneration })

    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '银发骑士' } })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    expect(await screen.findByText('请补充角色的美术风格。')).toBeTruthy()
    expect(startCharacterGeneration).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('创作指令'), {
      target: { value: '16-bit 像素风，请直接生成' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    const composerInput = (await screen.findByRole('textbox', {
      name: '创作指令',
    })) as HTMLInputElement
    expect(composerInput.value).toBe('')
    expect(
      await screen.findByText('我会保留银发骑士和 16-bit 风格，并整理为轮廓清楚的全身母版描述。'),
    ).toBeTruthy()
    expect(screen.getByText('银发骑士，16-bit 像素风，全身像')).toBeTruthy()
    expect(screen.queryByText(/默认处理|动作稍后处理|确认后点击发送/u)).toBeNull()
    expect(startCharacterGeneration).not.toHaveBeenCalled()

    await confirmAgentGeneration()
    await waitFor(() => expect(startCharacterGeneration).toHaveBeenCalledTimes(1))

    action.resolve({ runId: 'run-new' })
  })

  it('keeps the same Agent session after multiple text decisions', async () => {
    const plannerResults: PlannerResult[] = [
      { text: '请补充角色风格。', finishReason: 'stop', toolCalls: [] },
      { text: '描述仍有冲突，请修改后重新开始。', finishReason: 'stop', toolCalls: [] },
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          {
            toolName: 'start_character_generation',
            input: {
              optimizedPrompt: '银发像素骑士，全身像',
              optimizationSummary: '我会保留银发骑士特征，并整理为完整的全身母版描述。',
            },
          },
        ],
      },
    ]
    const planner = vi.fn(async (_input: PlannerInput) => plannerResults.shift()!)
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-new' }))
    renderAt('/quick-start', serviceFor(null), { planner, startCharacterGeneration })

    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '一个骑士' } })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    expect(await screen.findByText('请补充角色风格。')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('创作指令'), {
      target: { value: '仍然缺少明确风格' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(await screen.findByText('描述仍有冲突，请修改后重新开始。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '继续' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('创作指令'), {
      target: { value: '16-bit 银发像素骑士，请直接生成' },
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))

    expect(startCharacterGeneration).not.toHaveBeenCalled()
    await confirmAgentGeneration()
    await waitFor(() => expect(startCharacterGeneration).toHaveBeenCalledTimes(1))
    expect(planner.mock.calls[2]?.[0].messages).toEqual([
      { role: 'user', content: '一个骑士' },
      { role: 'assistant', content: '请补充角色风格。' },
      { role: 'user', content: '仍然缺少明确风格' },
      { role: 'assistant', content: '描述仍有冲突，请修改后重新开始。' },
      { role: 'user', content: '16-bit 银发像素骑士，请直接生成' },
    ])
  })

  it('shows first-frame confirmation instead of stale character candidates after a template is confirmed', async () => {
    const run = actionWorkflow({ firstStatus: 'active', firstPhase: 'selecting' })
    const service = serviceFor(run, {
      getTemplateCandidates: vi.fn(async () => eastCandidates('stale-template.png')),
      getFirstFrameCandidates: vi.fn(async () =>
        eastCandidates('first-frame.png', 'first-frame-2.png'),
      ),
    })
    const view = renderAt('/quick-start/run-1', service)

    await waitFor(() =>
      expect(
        view.container.querySelector('[data-agent-copy][aria-label^="已生成 2 个动作起始姿态"]'),
      ).toBeTruthy(),
    )
    const firstFrame = view.getByRole('img', { name: '动作首帧候选 1' })
    expect(firstFrame.getAttribute('loading')).toBe('eager')
    expect(firstFrame.getAttribute('decoding')).toBe('async')
    expect(firstFrame.getAttribute('fetchpriority')).toBe('high')
    expect(view.queryByRole('img', { name: '角色图候选 1' })).toBeNull()
  })

  it('submits both text and uploaded-template creation from the natural-language entry', async () => {
    const service = serviceFor(null)
    const startCharacterGeneration = vi.fn(async () => ({ runId: 'run-new' }))
    const agent = agentFor({ startCharacterGeneration })
    const view = renderAt('/quick-start', service, agent)

    expect((screen.getByRole('radio', { name: '单向' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '四向' }))
    fireEvent.click(screen.getByRole('button', { name: /16-bit 日式 RPG/u }))
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    expect(startCharacterGeneration).not.toHaveBeenCalled()
    await confirmAgentGeneration()
    await waitFor(() =>
      expect(startCharacterGeneration).toHaveBeenCalledWith({
        prompt: '16-bit 日式 RPG 像素风，清晰轮廓，明亮配色',
        directionalMovement: 'four-way',
      }),
    )
    expect(service.start).not.toHaveBeenCalled()

    view.unmount()
    renderAt('/quick-start', service)
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })
    fireEvent.click(screen.getByRole('radio', { name: '八向' }))
    fireEvent.click(screen.getByRole('button', { name: '添加母版' }))
    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })
    expect(screen.getByText('hero.png')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '挥手' } })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    await waitFor(() =>
      expect(service.startWithUploadedTemplate).toHaveBeenCalledWith(
        file,
        '挥手',
        expect.any(AbortSignal),
        'eight-way',
      ),
    )
  })

  it('hands the created session to the run page under the production StrictMode lifecycle', async () => {
    const run = workflow(setupAndTemplate({ phase: 'generating' }), 'run-new')
    const service = serviceFor(run)
    const agent = agentFor()
    const view = render(
      <StrictMode>
        <MemoryRouter initialEntries={['/quick-start']}>
          <Routes>
            <Route
              path="/quick-start"
              element={<QuickStartPage service={service} agent={agent} />}
            />
            <Route
              path="/quick-start/:runId"
              element={<QuickStartPage service={service} agent={agent} />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    )

    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '像素骑士' } })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    await confirmAgentGeneration()

    await waitFor(() => expect(service.resume).toHaveBeenCalled())
    expect(service.open).toHaveBeenCalledWith('run-new')
    expect(service.start).not.toHaveBeenCalled()
    expect(service.dispose).toHaveBeenCalledTimes(1)

    view.unmount()
    await waitFor(() => expect(service.dispose).toHaveBeenCalledTimes(2))
  })

  it('shows entry errors and supports removing an uploaded template', async () => {
    const service = serviceFor(null)
    const agent = agentFor({
      startCharacterGeneration: vi.fn(async () => Promise.reject(new Error('服务繁忙'))),
    })
    renderAt('/quick-start', service, agent)
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '移除图片' }))
    expect(screen.queryByText('hero.png')).toBeNull()
    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '骑士' } })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    await confirmAgentGeneration()
    expect((await screen.findByRole('alert')).textContent).toContain('服务繁忙')
  })

  it('keeps the uploaded template controls in the adaptive composer', () => {
    renderAt('/quick-start', serviceFor(null))
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })

    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })

    const composer = screen.getByLabelText('创作指令').closest('form')
    expect(screen.getByLabelText('创作指令').tagName).toBe('TEXTAREA')
    expect(composer?.textContent).toContain('hero.png')
    expect(screen.getByRole('button', { name: '移除图片' }).closest('form')).toBe(composer)
    expect(composer?.querySelector('[data-layout="quick-start-attachment-row"]')).toBeNull()
  })

  it('adds an action from the existing Quick Start run instead of creating another run', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const service = serviceFor(run)
    renderAt('/quick-start/run-1?intent=add-action&outfitId=outfit-1', service)

    const input = await screen.findByRole('textbox', { name: '继续描述你的想法' })
    const submit = screen.getByRole('button', { name: '发送' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: '挥手' } })
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(submit)

    await waitFor(() => expect(service.addAction).toHaveBeenCalledWith('outfit-1', '挥手'))
  })

  it('adds an action when an older action branch failed', async () => {
    const current = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const run = workflow([
      ...current.nodes.slice(0, 2),
      {
        ...current.nodes[4],
        id: 'failed-action-full',
        status: 'failed',
        error: '旧动作生成失败',
      },
      ...current.nodes.slice(2),
    ])
    const service = serviceFor(run)
    renderAt('/quick-start/run-1?intent=add-action&outfitId=outfit-1', service)

    const input = await screen.findByRole('textbox', { name: '继续描述你的想法' })
    fireEvent.change(input, { target: { value: '跳跃' } })

    const submit = screen.getByRole('button', { name: '发送' })
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(submit)
    await waitFor(() => expect(service.addAction).toHaveBeenCalledWith('outfit-1', '跳跃'))
  })

  it('reports add-action failures inside the existing Quick Start run', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const service = serviceFor(run, {
      addAction: vi.fn(async () => Promise.reject(new Error('动作生成暂时不可用'))),
    })
    renderAt('/quick-start/run-1?intent=add-action&outfitId=outfit-1', service)

    fireEvent.change(await screen.findByRole('textbox', { name: '继续描述你的想法' }), {
      target: { value: '挥手' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect((await screen.findByRole('alert')).textContent).toContain('动作生成暂时不可用')
  })

  it('recovers missing runs and returns to the creation entry', async () => {
    const service = serviceFor(null)
    renderAt('/quick-start/missing', service)
    expect(await screen.findByRole('heading', { name: '无法恢复这次创作' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回快速开始' }))
    expect(screen.getByRole('textbox', { name: '创作指令' })).toBeTruthy()
  })

  it('clears the saved entry when the backend confirms that run is missing', async () => {
    rememberActiveRun('7', 'missing')
    const service = serviceFor(null, {
      open: vi.fn(async () => {
        throw new ApiError('执行记录不存在', { kind: 'business', code: 404, status: 200 })
      }),
    })

    renderAt('/quick-start/missing', service)

    expect(await screen.findByRole('heading', { name: '无法恢复这次创作' })).toBeTruthy()
    expect(readActiveRun('7')).toBeNull()
  })

  it('opens a recoverable run once and accepts its session update', async () => {
    const run = workflow(setupAndTemplate())
    const service = serviceFor(run, {
      subscribe: vi.fn((listener) => {
        listener(run)
        return () => undefined
      }),
    })
    renderAt('/quick-start/run-1', service)
    await waitFor(() => expect(service.open).toHaveBeenCalledWith('run-1'))
    expect(service.resume).toHaveBeenCalledWith()
  })

  it('selects a character first, then submits its action through the conversation composer', async () => {
    const run = workflow(setupAndTemplate())
    const service = serviceFor(run, {
      getTemplateCandidates: vi.fn(async () =>
        eastCandidates('https://example.test/candidate.png'),
      ),
      confirmCandidate: vi.fn(async () => Promise.reject(new Error('候选确认失败'))),
      start: vi.fn(async () => Promise.reject(new Error('重新生成失败'))),
    })
    renderAt('/quick-start/run-1', service)
    const candidate = await screen.findByRole('img', { name: '角色图候选 1' })
    fireEvent.click(candidate)

    expect(service.confirmCandidate).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: '选择角色方案 1' }).getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.change(screen.getByLabelText('继续描述你的想法'), { target: { value: '挥手' } })
    fireEvent.click(screen.getByRole('button', { name: '确认选择，继续下一步' }))
    await waitFor(() =>
      expect(service.confirmCandidate).toHaveBeenCalledWith(
        { east: 'https://example.test/candidate.png' },
        '挥手',
      ),
    )
    expect((await screen.findByRole('alert')).textContent).toContain('候选确认失败')
    expect(screen.getByTestId('quick-start-run')).toBeTruthy()
  })

  it('freezes the current conversation and offers a full reload after a version conflict', async () => {
    const run = workflow(setupAndTemplate())
    const service = serviceFor(run, {
      getTemplateCandidates: vi.fn(async () =>
        eastCandidates('https://example.test/candidate.png'),
      ),
      confirmCandidate: vi.fn(async () => {
        throw new WorkflowRunConflictError('执行记录版本冲突，请刷新后重试')
      }),
    })
    renderAt('/quick-start/run-1?source=test#selection', service)

    fireEvent.click(await screen.findByRole('img', { name: '角色图候选 1' }))
    fireEvent.click(screen.getByRole('button', { name: '确认选择，继续下一步' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('工作流已在其他位置更新，请加载最新版本后继续。')
    expect(screen.getByRole('link', { name: '加载最新版本' }).getAttribute('href')).toBe(
      '/quick-start/run-1?source=test#selection',
    )
    const confirm = screen.getByRole('button', { name: '确认选择，继续下一步' })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirm)
    expect(service.confirmCandidate).toHaveBeenCalledTimes(1)
  })

  it('keeps a reported conflict visible when an earlier result read fails later', async () => {
    const run = workflow(setupAndTemplate())
    let reportError: ((error: Error) => void) | null = null
    let rejectRead: ((error: Error) => void) | null = null
    const pendingRead = new Promise<readonly QuickStartCandidate[]>((_resolve, reject) => {
      rejectRead = reject
    })
    const service = serviceFor(run, {
      getTemplateCandidates: vi.fn(() => pendingRead),
      subscribeErrors: vi.fn((listener) => {
        reportError = listener
        return () => undefined
      }),
    })
    renderAt('/quick-start/run-1', service)

    await waitFor(() => expect(service.getTemplateCandidates).toHaveBeenCalled())
    act(() => {
      reportError?.(new WorkflowRunConflictError('执行记录版本冲突，请刷新后重试'))
    })
    expect(await screen.findByRole('link', { name: '加载最新版本' })).toBeTruthy()

    await act(async () => {
      rejectRead?.(new Error('候选读取失败'))
      await pendingRead.catch(() => undefined)
    })
    expect(screen.getByRole('alert').textContent).toContain(
      '工作流已在其他位置更新，请加载最新版本后继续。',
    )
  })

  it('does not auto-save a completed action after the session reports a conflict', async () => {
    const run = workflow(setupAndTemplate())
    const completed = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'active' })
    let reportError: ((error: Error) => void) | null = null
    let reportRun: ((run: WorkflowRun) => void) | null = null
    const service = serviceFor(run, {
      subscribeErrors: vi.fn((listener) => {
        reportError = listener
        return () => undefined
      }),
      subscribe: vi.fn((listener) => {
        reportRun = listener
        return () => undefined
      }),
    })
    renderAt('/quick-start/run-1', service)

    await waitFor(() => expect(service.subscribeErrors).toHaveBeenCalledOnce())
    act(() => {
      reportError?.(new WorkflowRunConflictError('执行记录版本冲突，请刷新后重试'))
      reportRun?.(completed)
    })

    expect(await screen.findByRole('link', { name: '加载最新版本' })).toBeTruthy()
    await waitFor(() => expect(service.approveReview).not.toHaveBeenCalled())
  })

  it('ignores an old session resume result after navigating to another run', async () => {
    const oldRun = workflow(setupAndTemplate(), 'run-old')
    const newNodes = setupAndTemplate()
    const newSetup = newNodes[0]
    if (newSetup?.type !== 'character-setup') throw new Error('测试工作流缺少角色设定节点')
    newSetup.input.prompt = '新角色'
    const newRun = workflow(newNodes, 'run-new')
    let resolveOldResume: ((run: WorkflowRun) => void) | null = null
    const oldResume = new Promise<WorkflowRun>((resolve) => {
      resolveOldResume = resolve
    })
    const oldSession = serviceFor(oldRun, { resume: vi.fn(() => oldResume) })
    const newSession = serviceFor(newRun)
    const entryService = serviceFor(null, {
      open: vi.fn(async (id) => (id === oldRun.id ? oldSession : newSession)),
    })

    renderWithRunSwitcher(entryService, oldRun.id, newRun.id)

    expect(await screen.findByText('像素骑士')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切换当前运行' }))
    expect(await screen.findByText('新角色')).toBeTruthy()

    await act(async () => {
      resolveOldResume?.(oldRun)
      await oldResume
    })
    expect(screen.getByText('新角色')).toBeTruthy()
    expect(screen.queryByText('像素骑士')).toBeNull()
  })

  it('ignores old session result reads and error events after switching runs', async () => {
    const oldRun = workflow(setupAndTemplate(), 'run-old')
    const newNodes = setupAndTemplate()
    const newSetup = newNodes[0]
    if (newSetup?.type !== 'character-setup') throw new Error('测试工作流缺少角色设定节点')
    newSetup.input.prompt = '当前新运行'
    const newRun = workflow(newNodes, 'run-new')
    const oldRead = deferred<readonly QuickStartCandidate[]>()
    let reportOldError: ((error: Error) => void) | null = null
    const oldSession = serviceFor(oldRun, {
      getTemplateCandidates: vi.fn(() => oldRead.promise),
      subscribeErrors: vi.fn((listener) => {
        reportOldError = listener
        return () => undefined
      }),
    })
    const newSession = serviceFor(newRun)
    const entryService = serviceFor(null, {
      open: vi.fn(async (id) => (id === oldRun.id ? oldSession : newSession)),
    })

    renderWithRunSwitcher(entryService, oldRun.id, newRun.id)

    await waitFor(() => expect(oldSession.getTemplateCandidates).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '切换当前运行' }))
    expect(await screen.findByText('当前新运行')).toBeTruthy()

    await act(async () => {
      reportOldError?.(new Error('旧会话错误'))
      oldRead.reject(new Error('旧候选读取失败'))
      await oldRead.promise.catch(() => undefined)
    })
    expect(screen.queryByText(/旧会话错误|旧候选读取失败/u)).toBeNull()
  })

  it('ignores completed commands from the previous session after switching runs', async () => {
    const oldRun = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    oldRun.id = 'run-old'
    const newNodes = setupAndTemplate()
    const newSetup = newNodes[0]
    if (newSetup?.type !== 'character-setup') throw new Error('测试工作流缺少角色设定节点')
    newSetup.input.prompt = '当前新运行'
    const newRun = workflow(newNodes, 'run-new')
    const playtest = deferred<{ characterId: string; outfitId: string } | null>()
    const failedPlaytest = deferred<{ characterId: string; outfitId: string } | null>()
    const oldSession = serviceFor(oldRun, {
      getCharacterInfo: vi.fn(() => null),
      resolveCharacterInfo: vi
        .fn()
        .mockImplementationOnce(() => playtest.promise)
        .mockImplementationOnce(() => failedPlaytest.promise),
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/frame.png', durationMs: 80 },
      ]),
    })
    const newSession = serviceFor(newRun)
    const entryService = serviceFor(null, {
      open: vi.fn(async (id) => (id === oldRun.id ? oldSession : newSession)),
    })

    renderWithRunSwitcher(entryService, oldRun.id, newRun.id)

    fireEvent.click(await screen.findByRole('button', { name: '跳转到 Play Test' }))
    fireEvent.click(screen.getByRole('button', { name: '跳转到 Play Test' }))
    await waitFor(() => expect(oldSession.resolveCharacterInfo).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '切换当前运行' }))
    expect(await screen.findByText('当前新运行')).toBeTruthy()

    await act(async () => {
      playtest.resolve({ characterId: 'old-character', outfitId: 'old-outfit' })
      failedPlaytest.reject(new Error('旧 Play Test 打开失败'))
      await Promise.allSettled([playtest.promise, failedPlaytest.promise])
    })
    expect(screen.getByRole('status', { name: '当前位置' }).textContent).toBe(
      '/quick-start/run-new',
    )
    expect(screen.queryByText('旧 Play Test 打开失败')).toBeNull()
  })

  it('ignores automatic publishing completed by the previous session after switching runs', async () => {
    const oldRun = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'active' })
    oldRun.id = 'run-old'
    const newNodes = setupAndTemplate()
    const newSetup = newNodes[0]
    if (newSetup?.type !== 'character-setup') throw new Error('测试工作流缺少角色设定节点')
    newSetup.input.prompt = '当前新运行'
    const newRun = workflow(newNodes, 'run-new')
    const publish = deferred<WorkflowRun>()
    const oldSession = serviceFor(oldRun, {
      approveReview: vi.fn(() => publish.promise),
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/frame.png', durationMs: 80 },
      ]),
    })
    const newSession = serviceFor(newRun)
    const entryService = serviceFor(null, {
      open: vi.fn(async (id) => (id === oldRun.id ? oldSession : newSession)),
    })

    renderWithRunSwitcher(entryService, oldRun.id, newRun.id)

    await waitFor(() => expect(oldSession.approveReview).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '切换当前运行' }))
    expect(await screen.findByText('当前新运行')).toBeTruthy()

    await act(async () => {
      publish.resolve(actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' }))
      await publish.promise
    })
    expect(screen.getByText('当前新运行')).toBeTruthy()
  })

  it('disposes a regenerated session that resolves after navigating to another run', async () => {
    const oldRun = workflow(setupAndTemplate(), 'run-old')
    const newNodes = setupAndTemplate()
    const newSetup = newNodes[0]
    if (newSetup?.type !== 'character-setup') throw new Error('测试工作流缺少角色设定节点')
    newSetup.input.prompt = '当前新运行'
    const newRun = workflow(newNodes, 'run-new')
    const regeneratedRun = workflow(setupAndTemplate(), 'run-regenerated')
    const regeneratedSession = serviceFor(regeneratedRun)
    let resolveRegeneration: ((session: QuickStartSession) => void) | null = null
    const pendingRegeneration = new Promise<QuickStartSession>((resolve) => {
      resolveRegeneration = resolve
    })
    const oldSession = serviceFor(oldRun, {
      getTemplateCandidates: vi.fn(async () =>
        eastCandidates('https://example.test/candidate.png'),
      ),
    })
    const newSession = serviceFor(newRun)
    const entryService = serviceFor(null, {
      start: vi.fn(() => pendingRegeneration),
      open: vi.fn(async (id) => (id === oldRun.id ? oldSession : newSession)),
    })

    renderWithRunSwitcher(entryService, oldRun.id, newRun.id)

    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(entryService.start).toHaveBeenCalledWith('像素骑士'))
    fireEvent.click(screen.getByRole('button', { name: '切换当前运行' }))
    expect(await screen.findByText('当前新运行')).toBeTruthy()

    await act(async () => {
      resolveRegeneration?.(regeneratedSession)
      await pendingRegeneration
    })
    expect(screen.getByRole('status', { name: '当前位置' }).textContent).toBe(
      '/quick-start/run-new',
    )
    expect(regeneratedSession.dispose).toHaveBeenCalledOnce()
  })

  it('ignores a regeneration error after navigating to another run', async () => {
    const oldRun = workflow(setupAndTemplate(), 'run-old')
    const newNodes = setupAndTemplate()
    const newSetup = newNodes[0]
    if (newSetup?.type !== 'character-setup') throw new Error('测试工作流缺少角色设定节点')
    newSetup.input.prompt = '当前新运行'
    const newRun = workflow(newNodes, 'run-new')
    const regeneration = deferred<QuickStartSession>()
    const oldSession = serviceFor(oldRun, {
      getTemplateCandidates: vi.fn(async () =>
        eastCandidates('https://example.test/candidate.png'),
      ),
    })
    const newSession = serviceFor(newRun)
    const entryService = serviceFor(null, {
      start: vi.fn(() => regeneration.promise),
      open: vi.fn(async (id) => (id === oldRun.id ? oldSession : newSession)),
    })

    renderWithRunSwitcher(entryService, oldRun.id, newRun.id)

    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(entryService.start).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '切换当前运行' }))
    expect(await screen.findByText('当前新运行')).toBeTruthy()

    await act(async () => {
      regeneration.reject(new Error('旧重新生成失败'))
      await regeneration.promise.catch(() => undefined)
    })
    expect(screen.getByRole('status', { name: '当前位置' }).textContent).toBe(
      '/quick-start/run-new',
    )
    expect(screen.queryByText('旧重新生成失败')).toBeNull()
  })

  it('keeps the original regenerate and new-creation controls reachable', async () => {
    const run = workflow(setupAndTemplate())
    const service = serviceFor(run, {
      getTemplateCandidates: vi.fn(async () =>
        eastCandidates('https://example.test/candidate.png'),
      ),
      start: vi.fn(async () => Promise.reject(new Error('重新生成失败'))),
    })
    renderAt('/quick-start/run-1', service)

    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(service.start).toHaveBeenCalledWith('像素骑士'))
    expect((await screen.findByRole('alert')).textContent).toContain('重新生成失败')

    fireEvent.click(screen.getByRole('button', { name: '新建一次创作' }))
    expect(screen.getByRole('textbox', { name: '创作指令' })).toBeTruthy()
  })

  it('confirms a generated first frame before starting the full animation', async () => {
    const run = actionWorkflow({ firstStatus: 'active', firstPhase: 'selecting' })
    const service = serviceFor(run, {
      getFirstFrameCandidates: vi.fn(async () => eastCandidates('https://example.test/first.png')),
      confirmFirstFrame: vi.fn(async () => Promise.reject(new Error('首帧确认失败'))),
    })
    renderAt('/quick-start/run-1', service)
    fireEvent.click(await screen.findByRole('img', { name: '动作首帧候选 1' }))
    expect(service.confirmFirstFrame).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认首帧，生成完整动作' }))
    await waitFor(() =>
      expect(service.confirmFirstFrame).toHaveBeenCalledWith({
        east: 'https://example.test/first.png',
      }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain('首帧确认失败')
  })

  it('collapses first-frame candidates to the confirmed frame after confirmation', async () => {
    const selectingRun = actionWorkflow({ firstStatus: 'active', firstPhase: 'selecting' })
    const confirmedRun = actionWorkflow({ fullStatus: 'active' })
    const confirmedFirstFrame = confirmedRun.nodes.find(
      (node) => node.type === 'action-first-frame',
    )
    if (!confirmedFirstFrame || confirmedFirstFrame.type !== 'action-first-frame') {
      throw new Error('测试工作流缺少动作首帧节点')
    }
    confirmedFirstFrame.selectedFirstFrameUrl = 'first-2.png'
    const pendingRefresh = deferred<ExportPackageModel | null>()
    const service = serviceFor(selectingRun, {
      getFirstFrameCandidates: vi.fn(async () =>
        eastCandidates('first-1.png', 'first-2.png', 'first-3.png'),
      ),
      confirmFirstFrame: vi.fn(async () => confirmedRun),
      getExportModel: vi.fn().mockResolvedValueOnce(null).mockReturnValue(pendingRefresh.promise),
    })
    renderAt('/quick-start/run-1', service)

    fireEvent.click(await screen.findByRole('button', { name: '选择动作首帧 2' }))
    fireEvent.click(screen.getByRole('button', { name: '确认首帧，生成完整动作' }))

    expect((await screen.findByRole('img', { name: '已选择的动作首帧' })).getAttribute('src')).toBe(
      'first-2.png',
    )
    expect(screen.queryByRole('img', { name: /动作首帧候选/u })).toBeNull()
  })

  it('四向动作首帧全部选定后才确认并生成完整动作', async () => {
    const run = actionWorkflow({ firstStatus: 'active', firstPhase: 'selecting' })
    const service = serviceFor(run, {
      getFirstFrameCandidates: vi.fn(
        async () =>
          [
            { direction: 'east', index: 0, imageUrl: 'east-1.png' },
            { direction: 'east', index: 1, imageUrl: 'east-2.png' },
            { direction: 'west', index: 0, imageUrl: 'west-1.png' },
            { direction: 'west', index: 1, imageUrl: 'west-2.png' },
            { direction: 'north', index: 0, imageUrl: 'north-1.png' },
            { direction: 'north', index: 1, imageUrl: 'north-2.png' },
            { direction: 'south', index: 0, imageUrl: 'south-1.png' },
            { direction: 'south', index: 1, imageUrl: 'south-2.png' },
          ] satisfies readonly QuickStartCandidate[],
      ),
    })
    renderAt('/quick-start/run-1', service)

    fireEvent.click(await screen.findByRole('button', { name: '选择东方向动作首帧 1' }))
    expect(screen.queryByRole('button', { name: '确认首帧，生成完整动作' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '选择西方向动作首帧 2' }))
    expect(screen.queryByRole('button', { name: '确认首帧，生成完整动作' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '选择北方向动作首帧 2' }))
    expect(screen.queryByRole('button', { name: '确认首帧，生成完整动作' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '选择南方向动作首帧 1' }))
    fireEvent.click(screen.getByRole('button', { name: '确认首帧，生成完整动作' }))

    await waitFor(() =>
      expect(service.confirmFirstFrame).toHaveBeenCalledWith({
        east: 'east-1.png',
        west: 'west-2.png',
        north: 'north-2.png',
        south: 'south-1.png',
      }),
    )
  })

  it('renders generating and failed states for both first-frame and full animation tasks', async () => {
    const states = [
      [actionWorkflow({ firstStatus: 'active', firstPhase: 'generating' }), '动作首帧生成进度'],
      [actionWorkflow({ firstStatus: 'failed', error: '首帧服务失败' }), '动作首帧生成失败'],
      [actionWorkflow({ fullStatus: 'active' }), '完整动作生成进度'],
      [actionWorkflow({ fullStatus: 'failed', error: '动作服务失败' }), '动作生成失败'],
    ] as const

    for (const [run, label] of states) {
      const view = renderAt('/quick-start/run-1', serviceFor(run))
      expect(await screen.findByLabelText(new RegExp(label, 'u'))).toBeTruthy()
      view.unmount()
    }
  })

  it('只重试 Quick Start 中失败的源方向', async () => {
    const run = actionWorkflow({ firstStatus: 'failed', error: '北方向失败' })
    const firstFrame = run.nodes.find((node) => node.type === 'action-first-frame')!
    firstFrame.generations = [
      { taskId: 'first-east', role: 'first_frame' },
      { taskId: 'first-north', role: 'first_frame', direction: 'north' },
    ]
    const service = serviceFor(run, {
      getFailedGenerationDirections: vi.fn(async () => [
        { nodeId: 'action-first', direction: 'north' as const },
      ]),
      retryGenerationDirection: vi.fn(async () => run),
    })
    renderAt('/quick-start/run-1', service)

    fireEvent.click(await screen.findByRole('button', { name: '重试北方向' }))

    await waitFor(() =>
      expect(service.retryGenerationDirection).toHaveBeenCalledWith('action-first', 'north'),
    )
  })

  it('角色母版失败时也提供定向重试入口', async () => {
    const run = workflow(
      setupAndTemplate({
        status: 'failed',
        phase: 'generating',
        error: '北向母版失败',
        generations: [
          { taskId: 'template-east', role: 'character_template' },
          { taskId: 'template-north', role: 'character_template', direction: 'north' },
        ],
      }),
    )
    const service = serviceFor(run, {
      getFailedGenerationDirections: vi.fn(async () => [
        { nodeId: 'character-template', direction: 'north' as const },
      ]),
      retryGenerationDirection: vi.fn(async () => run),
    })
    renderAt('/quick-start/run-1', service)

    fireEvent.click(await screen.findByRole('button', { name: '重试北方向' }))

    await waitFor(() =>
      expect(service.retryGenerationDirection).toHaveBeenCalledWith('character-template', 'north'),
    )
  })

  it('方向重试失败时显示原始错误并恢复按钮', async () => {
    const run = actionWorkflow({ firstStatus: 'failed', error: '北方向失败' })
    const service = serviceFor(run, {
      getFailedGenerationDirections: vi.fn(async () => [
        { nodeId: 'action-first', direction: 'north' as const },
      ]),
      retryGenerationDirection: vi.fn(async () => Promise.reject(new Error('north retry failed'))),
    })
    renderAt('/quick-start/run-1', service)

    const retryButton = await screen.findByRole('button', { name: '重试北方向' })
    fireEvent.click(retryButton)

    expect((await screen.findByRole('alert')).textContent).toContain('north retry failed')
    await waitFor(() => expect((retryButton as HTMLButtonElement).disabled).toBe(false))
  })

  it('saves a completed animation without navigating and exposes both explicit destinations', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'active' })
    const approved = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const service = serviceFor(run, {
      approveReview: vi.fn(async () => approved),
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/frame-0.png', durationMs: 80 },
        { index: 1, imageUrl: 'https://example.test/frame-1.png', durationMs: 80 },
      ]),
    })
    const view = renderAt('/quick-start/run-1', service)
    await waitFor(() => expect(service.approveReview).toHaveBeenCalledWith())
    expect(screen.getByTestId('quick-start-run')).toBeTruthy()
    expect(screen.getByRole('button', { name: '跳转到资产工作台' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '跳转到 Play Test' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '跳转到资产工作台' }))
    expect(await screen.findByRole('heading', { name: '/projects/project-1/assets' })).toBeTruthy()

    view.unmount()
    const approvedService = serviceFor(approved, {
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/frame-0.png', durationMs: 80 },
      ]),
    })
    renderAt('/quick-start/run-1', approvedService)
    fireEvent.click(await screen.findByRole('button', { name: '跳转到 Play Test' }))
    expect(
      await screen.findByRole('heading', {
        name: '/playtest/character-1/outfit-1?actionId=action-full',
      }),
    ).toBeTruthy()
  })

  it('keeps a completed run recoverable when saving fails', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'active' })
    const approved = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const service = serviceFor(run, {
      approveReview: vi
        .fn()
        .mockRejectedValueOnce(new Error('保存失败'))
        .mockResolvedValue(approved),
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/frame.png', durationMs: 80 },
      ]),
    })
    renderAt('/quick-start/run-1', service)
    expect((await screen.findByRole('alert')).textContent).toContain('保存失败')
    fireEvent.click(screen.getByRole('button', { name: '重新保存' }))
    await waitFor(() => expect(service.approveReview).toHaveBeenCalledTimes(2))
  })

  it('keeps the completed run open when Play Test cannot resolve the character binding', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const service = serviceFor(run, {
      getCharacterInfo: vi.fn(() => null),
      resolveCharacterInfo: vi.fn(async () => null),
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/frame.png', durationMs: 80 },
      ]),
    })
    renderAt('/quick-start/run-1', service)
    fireEvent.click(await screen.findByRole('button', { name: '跳转到 Play Test' }))
    expect((await screen.findByRole('alert')).textContent).toContain('没有找到对应的角色资产')
    expect(screen.getByTestId('quick-start-run')).toBeTruthy()
  })

  it('keeps the original workflow interruption control reachable in the conversation', async () => {
    const run = actionWorkflow({ fullStatus: 'active' })
    const service = serviceFor(run, {
      interrupt: vi.fn(async () => Promise.reject(new Error('无法中断'))),
    })
    renderAt('/quick-start/run-1', service)
    const interrupt = await screen.findByRole('button', { name: '中断自动制作' })
    expect(interrupt.querySelector('svg')).toBeTruthy()
    fireEvent.click(interrupt)
    await waitFor(() => expect(service.interrupt).toHaveBeenCalledWith())
    expect((await screen.findByRole('alert')).textContent).toContain('无法中断')
  })
})
// @vitest-environment jsdom
