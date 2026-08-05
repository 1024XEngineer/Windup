/**
 * 状态机存储不变量穷举测试。
 *
 * 每个状态转换点之后，run 必须满足 createWorkflowRunStore 的持久化校验
 * （刷新页面后能从 localStorage 恢复）。曾因 completeActionGeneration 后
 * review 未激活导致 active 步骤数为 0，刷新后 run 被校验过滤直接丢失。
 */
import { describe, expect, it, vi } from 'vitest'

import type {
  Generation,
  GenerationApis,
  GenerationEvent,
  GenerationInput,
  WorkflowRun,
} from '@/entities'
import { createWorkflowRunStore } from '@/entities/workflow-run/store'
import { createWorkflowController } from '.'

/** 内存版 localStorage：save 后重建 store 即模拟刷新恢复。 */
function createRefreshableStore() {
  let snapshot: string | null = null
  const storage = {
    getItem: (key: string) => (key === 'windup.workflow-runs' ? snapshot : null),
    setItem: (_key: string, value: string) => {
      snapshot = value
    },
  }
  const store = createWorkflowRunStore({ storage })
  return {
    store,
    /** 模拟刷新：用同一份 storage 快照重建 store。 */
    refresh(): typeof store {
      return createWorkflowRunStore({ storage })
    },
  }
}

function createHarness() {
  const { store, refresh } = createRefreshableStore()
  const taskListeners = new Map<string, (event: GenerationEvent) => void>()

  const generationApis: GenerationApis = {
    create: vi.fn(
      async <T extends GenerationInput>(input: T) =>
        ({
          id: 'task-1',
          projectId: input.projectId,
          type: input.type,
          status: 'pending',
          result: null,
          error: null,
        }) as Generation<T['type']>,
    ),
    get: vi.fn(async () => {
      throw new Error('not used')
    }),
    subscribe: vi.fn(
      (_projectId: string, taskId: string, onEvent: (e: GenerationEvent) => void) => {
        taskListeners.set(taskId, onEvent)
        onEvent({
          taskId,
          type: 'character_template',
          status: 'pending',
          error: null,
          result: null,
        })
        return () => {
          taskListeners.delete(taskId)
        }
      },
    ),
  }
  let idCounter = 0
  const controller = createWorkflowController({
    store,
    generationApis,
    createId: (scope) => `id-${scope}-${++idCounter}`,
    now: () => '2026-07-31T12:00:00.000Z',
  })

  return {
    store,
    refresh,
    taskListeners,
    controller,
    completeTemplateTask(taskId: string) {
      const listener = taskListeners.get(taskId)
      if (!listener) throw new Error(`missing listener ${taskId}`)
      listener({
        taskId,
        type: 'character_template',
        status: 'completed',
        error: null,
        result: { type: 'character_template', images: [{ url: 'https://example.com/c.png' }] },
      })
    },
  }
}

/** 断言 run 在刷新后仍可恢复（即通过 store 持久化校验）。 */
function expectRefreshable(
  harness: ReturnType<typeof createHarness>,
  runId: string,
  label: string,
): WorkflowRun {
  const restored = harness.refresh().get(runId)
  expect(restored, `${label} 刷新后应可恢复`).not.toBeNull()
  return restored!
}

describe('store invariants across every state transition', () => {
  it('an add_action run survives refresh before generation starts', () => {
    const harness = createHarness()
    const created = harness.controller.create({
      projectId: 'project-1',
      purpose: 'add_action',
      driver: 'ai',
      prompt: '挥手',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'https://example.com/template.png',
      baseFrameUrls: [],
    })

    const restored = expectRefreshable(harness, created.id, '增加动作运行创建后')
    expect(restored.characterId).toBe('character-1')
    expect(restored.outfitId).toBe('outfit-1')
    expect(
      restored.revisions[0]?.steps.find((step) => step.type === 'action-generation')?.status,
    ).toBe('active')
  })

  it('every step of the happy path survives a refresh', async () => {
    const harness = createHarness()

    // 1. 创建（character-setup active）
    const created = harness.controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      driver: 'ai',
      prompt: '像素骑士',
    })
    const r1 = expectRefreshable(harness, created.id, '创建后')
    expect(r1.revisions[0]!.steps.filter((s) => s.status === 'active')).toHaveLength(1)

    // 2. 提交角色图任务（character-template active + submissionId）
    await harness.controller.nextStep(created.id, { width: 256, height: 256 })
    const r2 = expectRefreshable(harness, created.id, '角色图任务提交后')
    const templateStep2 = r2.revisions[0]!.steps.find((s) => s.type === 'character-template')!
    expect(templateStep2.status).toBe('active')
    expect(r2.revisions[0]!.steps.filter((s) => s.status === 'active')).toHaveLength(1)

    // 3. 角色图完成（character-template passed → template-candidate active）
    harness.completeTemplateTask('task-1')
    const r3 = expectRefreshable(harness, created.id, '角色图完成后')
    expect(r3.revisions[0]!.steps.find((s) => s.type === 'template-candidate')!.status).toBe(
      'active',
    )

    // 4. 确认候选（action-generation active）
    harness.controller.confirmCandidate(created.id, 'https://example.com/c.png')
    const r4 = expectRefreshable(harness, created.id, '确认候选后')
    expect(r4.revisions[0]!.steps.find((s) => s.type === 'action-generation')!.status).toBe(
      'active',
    )
    expect(r4.revisions[0]!.steps.filter((s) => s.status === 'active')).toHaveLength(1)

    // 5. 动作生成完成（action-generation passed → review active）
    harness.controller.recordActionGenerationTask(created.id, 'task-action-1')
    harness.controller.completeActionGeneration(created.id, {
      type: 'complete_animation',
      actionType: 'idle',
      frames: [{ url: 'https://example.com/f.png', durationMs: 125 }],
    })
    const r5 = expectRefreshable(harness, created.id, '动作完成后')
    const reviewStep = r5.revisions[0]!.steps.find((s) => s.type === 'review')!
    expect(reviewStep.status).toBe('active')
    expect(r5.revisions[0]!.steps.filter((s) => s.status === 'active')).toHaveLength(1)
  })

  it('a failed action generation survives a refresh and stays failed', async () => {
    const harness = createHarness()
    const created = harness.controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      driver: 'ai',
      prompt: '像素骑士',
    })
    await harness.controller.nextStep(created.id, { width: 256, height: 256 })
    harness.completeTemplateTask('task-1')
    harness.controller.confirmCandidate(created.id, 'https://example.com/c.png')

    harness.controller.completeActionGeneration(created.id, { error: '生成服务超时' })

    const r = expectRefreshable(harness, created.id, '动作失败后')
    expect(r.status).toBe('failed')
    expect(r.revisions[0]!.steps.filter((s) => s.status === 'active')).toHaveLength(0)
    expect(r.revisions[0]!.steps.find((s) => s.type === 'action-generation')!.status).toBe('failed')
  })

  it('an interrupted run survives a refresh with exactly one active step', async () => {
    const harness = createHarness()
    const created = harness.controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      driver: 'ai',
      prompt: '像素骑士',
    })

    harness.controller.interrupt(created.id)

    const r = expectRefreshable(harness, created.id, '中断后')
    expect(r.status).toBe('interrupted')
    expect(r.revisions[0]!.steps.filter((s) => s.status === 'active')).toHaveLength(1)
  })

  it('a restart from a passed step survives a refresh', async () => {
    const harness = createHarness()
    const created = harness.controller.create({
      projectId: 'project-1',
      purpose: 'create_character',
      driver: 'ai',
      prompt: '像素骑士',
    })
    await harness.controller.nextStep(created.id, { width: 256, height: 256 })
    harness.completeTemplateTask('task-1')
    const after = harness.controller.getWorkflow(created.id)!
    const revision = after.revisions[0]!
    const setupStep = revision.steps.find((s) => s.type === 'character-setup')!

    harness.controller.restart(created.id, setupStep.id)

    const r = expectRefreshable(harness, created.id, '重开后')
    expect(r.revisions).toHaveLength(2)
    expect(r.revisions[0]!.status).toBe('abandoned')
    expect(r.revisions[1]!.steps.filter((s) => s.status === 'active')).toHaveLength(1)
  })
})
