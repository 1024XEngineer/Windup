/**
 * WorkflowRun Store 的可执行业务规则。
 *
 * 这些测试不是在验证页面点击，而是锁定数据层不得破坏的契约：
 * 角色/动作任务的步骤必须分开，完成角色任务前必须有正式资产，
 * 临时候选不得进入持久化快照，Revision 历史引用不得悬空。
 */

import { describe, expect, it, vi } from 'vitest'

import type { WorkflowRevision, WorkflowRun, WorkflowRunPurpose, WorkflowStep } from '../model'
import {
  createWorkflowRunStore,
  WORKFLOW_RUN_STORAGE_KEY,
  WORKFLOW_RUN_STORAGE_VERSION,
} from './workflow-run-store'
import { CHARACTER_CANDIDATE_COUNT, WORKFLOW_STEP_ORDERS } from '../model/constants'

/** 最小 localStorage 替身：既可观察序列化结果，也可主动模拟浏览器存储失败。 */
class TestStorage {
  value: string | null
  failOnSet = false

  constructor(value: string | null = null) {
    this.value = value
  }

  getItem() {
    return this.value
  }

  setItem(_key: string, value: string) {
    if (this.failOnSet) throw new Error('storage full')
    this.value = value
  }
}

/** 根据 purpose 生成测试快照，避免测试自己重复写一套容易过期的步骤顺序。 */
function createSteps(
  prefix: string,
  purpose: WorkflowRunPurpose = 'create_character',
  activeIndex = 0,
): WorkflowStep[] {
  return WORKFLOW_STEP_ORDERS[purpose].map((type, index) => ({
    id: `${prefix}:${type}`,
    type,
    status: index === activeIndex ? 'active' : 'locked',
    taskId: null,
    candidateTaskIds: [],
    submissionId: null,
    error: null,
    referenceStepIds: [],
  }))
}

function createRevision(
  id = 'revision-1',
  purpose: WorkflowRunPurpose = 'create_character',
): WorkflowRevision {
  return {
    id,
    basedOnRevisionId: null,
    restartStepId: null,
    status: 'active',
    steps: createSteps(id, purpose),
    generationStatus: 'not_started',
    exportStatus: 'not_exported',
    createdAt: '2026-08-03T00:00:00.000Z',
  }
}

function createRun(id = 'run-1'): WorkflowRun {
  return {
    id,
    projectId: 'project-1',
    characterId: null,
    outfitId: null,
    selectedAt: null,
    purpose: 'create_character',
    driver: 'ai',
    status: 'active',
    currentRevisionId: 'revision-1',
    revisions: [createRevision()],
    prompt: 'Create a hero',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  }
}

function createAddActionRun(): WorkflowRun {
  const base = createRun('run-add-action')
  return {
    id: base.id,
    projectId: base.projectId,
    purpose: 'add_action',
    characterId: 'character-1',
    outfitId: 'outfit-1',
    actionId: 'action-1',
    actionName: '向前行走',
    actionType: 'walk',
    fps: 12,
    driver: base.driver,
    status: base.status,
    currentRevisionId: base.currentRevisionId,
    revisions: [createRevision('revision-1', 'add_action')],
    prompt: 'Walk forward',
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  }
}

/** 构造“从已通过步骤重做”的两版本历史，用于校验来源链。 */
function createRunWithHistory(): WorkflowRun {
  const first = createRevision()
  first.status = 'abandoned'
  first.steps = first.steps.map((step, index) => ({
    ...step,
    status: index === 0 ? 'passed' : 'locked',
  }))
  const second = createRevision('revision-2')
  second.basedOnRevisionId = first.id
  second.restartStepId = first.steps[0]!.id
  second.steps[0]!.referenceStepIds = [first.steps[0]!.id]

  return {
    ...createRun(),
    currentRevisionId: second.id,
    revisions: [first, second],
  }
}

describe('createWorkflowRunStore', () => {
  // 创建契约：同一界面可连续完成两任务，但底层必须创建两种不同步骤模板的 Run。
  it('creates a character task with only the character steps', () => {
    const ids = ['run-1', 'revision-1', 'step-1', 'step-2', 'step-3']
    const store = createWorkflowRunStore({
      storage: null,
      createId: () => ids.shift()!,
      now: () => '2026-08-03T01:00:00.000Z',
    })

    const run = store.create({
      projectId: 'project-1',
      purpose: 'create_character',
      driver: 'ai',
      prompt: '  Create a hero  ',
    })

    expect(CHARACTER_CANDIDATE_COUNT).toBe(4)
    expect(run).toMatchObject({
      id: 'run-1',
      purpose: 'create_character',
      characterId: null,
      outfitId: null,
      selectedAt: null,
      prompt: 'Create a hero',
      createdAt: '2026-08-03T01:00:00.000Z',
      updatedAt: '2026-08-03T01:00:00.000Z',
    })
    expect(run.revisions[0]?.steps.map((step) => step.type)).toEqual(
      WORKFLOW_STEP_ORDERS.create_character,
    )
    expect(run.revisions[0]?.steps.map((step) => step.status)).toEqual([
      'active',
      'locked',
      'locked',
    ])
  })

  it('creates an action task only from an existing character and outfit', () => {
    const ids = [
      'run-2',
      'revision-2',
      'step-1',
      'step-2',
      'step-3',
      'step-4',
      'step-5',
      'step-6',
      'action-1',
    ]
    const store = createWorkflowRunStore({
      storage: null,
      createId: () => ids.shift()!,
      now: () => '2026-08-03T02:00:00.000Z',
    })

    const run = store.create({
      projectId: 'project-1',
      purpose: 'add_action',
      driver: 'manual',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionName: '向前行走',
      actionType: 'walk',
      fps: 12,
      prompt: 'Walk forward',
    })

    expect(run).toMatchObject({
      purpose: 'add_action',
      characterId: 'character-1',
      outfitId: 'outfit-1',
      actionId: 'action-1',
      actionName: '向前行走',
      actionType: 'walk',
      fps: 12,
    })
    expect(run.revisions[0]?.steps.map((step) => step.type)).toEqual(
      WORKFLOW_STEP_ORDERS.add_action,
    )
  })

  // 快照所有权契约：保存后修改原对象或查询结果，都不能绕过 Store 改写内存。
  it('persists versioned snapshots and returns defensive copies', () => {
    const storage = new TestStorage()
    const store = createWorkflowRunStore({ storage })
    const run = createRun()

    store.save(run)
    run.prompt = 'changed outside'
    const restored = store.get(run.id)!
    restored.revisions[0]!.steps[0]!.status = 'failed'

    expect(store.get(run.id)?.prompt).toBe('Create a hero')
    expect(store.get(run.id)?.revisions[0]?.steps[0]?.status).toBe('active')
    expect(JSON.parse(storage.value!)).toEqual({
      version: WORKFLOW_RUN_STORAGE_VERSION,
      runs: [createRun()],
    })
  })

  it('hydrates a valid revision history and exposes it through list', () => {
    const run = createRunWithHistory()
    const storage = new TestStorage(
      JSON.stringify({ version: WORKFLOW_RUN_STORAGE_VERSION, runs: [run] }),
    )
    const store = createWorkflowRunStore({ storage })

    expect(store.get(run.id)).toEqual(run)
    expect(store.list()).toEqual([run])
  })

  // 恢复边界采用严格白名单：坏 JSON、未知版本和断裂历史链都不得进入内存。
  it.each([
    ['invalid JSON', '{'],
    ['unknown version', JSON.stringify({ version: 99, runs: [createRun()] })],
    [
      'missing history source',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [
          {
            ...createRunWithHistory(),
            revisions: [
              createRunWithHistory().revisions[0],
              { ...createRunWithHistory().revisions[1], basedOnRevisionId: 'missing' },
            ],
          },
        ],
      }),
    ],
    [
      'unknown referenced step',
      JSON.stringify({
        version: WORKFLOW_RUN_STORAGE_VERSION,
        runs: [
          {
            ...createRunWithHistory(),
            revisions: [
              createRunWithHistory().revisions[0],
              {
                ...createRunWithHistory().revisions[1],
                steps: createRunWithHistory().revisions[1]!.steps.map((step, index) =>
                  index === 0 ? { ...step, referenceStepIds: ['missing-step'] } : step,
                ),
              },
            ],
          },
        ],
      }),
    ],
  ])('ignores %s during hydration', (_label, serialized) => {
    expect(createWorkflowRunStore({ storage: new TestStorage(serialized) }).list()).toEqual([])
  })

  it('rejects invalid snapshots before they reach memory', () => {
    const store = createWorkflowRunStore({ storage: null })
    const invalid = createRun()
    invalid.revisions[0]!.steps[0]!.error = 'failed without failed status'

    expect(() => store.save(invalid)).toThrow('Invalid WorkflowRun snapshot')
    expect(store.get(invalid.id)).toBeNull()
  })

  // 动作不是游离资产；它必须同时定位角色和具体造型。
  it('requires character and outfit references when adding an action', () => {
    const valid = createAddActionRun()
    const store = createWorkflowRunStore({ storage: null })

    store.save(valid)
    expect(store.get(valid.id)).toEqual(valid)

    const invalid = {
      ...valid,
      characterId: null,
      outfitId: null,
    } as unknown as WorkflowRun
    expect(() => store.save(invalid)).toThrow('Invalid WorkflowRun snapshot')

    const hydrated = createWorkflowRunStore({
      storage: new TestStorage(
        JSON.stringify({ version: WORKFLOW_RUN_STORAGE_VERSION, runs: [invalid] }),
      ),
    })
    expect(hydrated.get(invalid.id)).toBeNull()
  })

  // 用户点选候选并不等于任务完成；必须等正式资产保存成功后再原子性填入三个字段。
  it('requires a saved asset and selection time before completing character creation', () => {
    const valid = createRun()
    valid.status = 'completed'
    valid.characterId = 'character-1'
    valid.outfitId = 'outfit-1'
    valid.selectedAt = '2026-08-03T03:00:00.000Z'
    valid.revisions[0]!.status = 'completed'
    valid.revisions[0]!.steps = valid.revisions[0]!.steps.map((step) => ({
      ...step,
      status: 'passed',
    }))
    const store = createWorkflowRunStore({ storage: null })

    store.save(valid)
    expect(store.get(valid.id)).toEqual(valid)

    const missingSelection = { ...valid, selectedAt: null } as unknown as WorkflowRun
    expect(() => store.save(missingSelection)).toThrow('Invalid WorkflowRun snapshot')
  })

  // taskId 是追踪线索，不是仅在加载中存活的 UI 状态。
  it('retains a generation task id after its step passes', () => {
    const run = createRun()
    run.revisions[0]!.steps[0] = {
      ...run.revisions[0]!.steps[0]!,
      status: 'passed',
      taskId: 'generation-1',
    }
    run.revisions[0]!.steps[1] = {
      ...run.revisions[0]!.steps[1]!,
      status: 'active',
    }
    const store = createWorkflowRunStore({ storage: null })

    store.save(run)

    expect(store.get(run.id)?.revisions[0]?.steps[0]?.taskId).toBe('generation-1')
  })

  it('requires exactly four task ids before the first-frame batch can pass', () => {
    const run = createAddActionRun()
    const steps = run.revisions[0]!.steps
    steps[0]!.status = 'passed'
    steps[1]!.status = 'passed'
    steps[1]!.candidateTaskIds = ['first-1', 'first-2', 'first-3']
    steps[2]!.status = 'active'
    const store = createWorkflowRunStore({ storage: null })

    expect(() => store.save(run)).toThrow('Invalid WorkflowRun snapshot')

    steps[1]!.candidateTaskIds.push('first-4')
    store.save(run)
    expect(store.get(run.id)?.revisions[0]?.steps[1]?.candidateTaskIds).toHaveLength(4)
  })

  // 四张候选属于临时缓存；运行历史只记录生成 taskId 和最终正式资产引用。
  it('rejects temporary candidate payloads in persisted workflow steps', () => {
    const run = createRun()
    const withCandidates = {
      ...run,
      revisions: [
        {
          ...run.revisions[0],
          steps: run.revisions[0]!.steps.map((step, index) =>
            index === 1
              ? {
                  ...step,
                  output: {
                    candidates: ['temporary-1', 'temporary-2', 'temporary-3', 'temporary-4'],
                  },
                }
              : step,
          ),
        },
      ],
    } as unknown as WorkflowRun
    const store = createWorkflowRunStore({ storage: null })

    expect(() => store.save(withCandidates)).toThrow('Invalid WorkflowRun snapshot')
  })

  // localStorage 失败不应让当前会话已完成的操作倒退，但刷新恢复能力会降级。
  it('keeps memory authoritative when persistence fails', () => {
    const storage = new TestStorage()
    storage.failOnSet = true
    const store = createWorkflowRunStore({ storage })

    expect(() => store.save(createRun())).not.toThrow()
    expect(store.get('run-1')).toEqual(createRun())
  })

  it('notifies run and history subscribers without sharing mutable values', () => {
    const store = createWorkflowRunStore({ storage: null })
    const runListener = vi.fn((run: WorkflowRun) => {
      run.prompt = 'listener mutation'
    })
    const listListener = vi.fn()
    const unsubscribeRun = store.subscribe('run-1', runListener)
    const unsubscribeAll = store.subscribeAll(listListener)

    store.save(createRun())

    expect(store.get('run-1')?.prompt).toBe('Create a hero')
    expect(listListener).toHaveBeenCalledWith([createRun()])
    unsubscribeRun()
    unsubscribeAll()
    store.save({ ...createRun(), prompt: 'second save' })
    expect(runListener).toHaveBeenCalledTimes(1)
    expect(listListener).toHaveBeenCalledTimes(1)
  })

  it('uses the stable browser storage key', () => {
    const setItem = vi.fn()
    const store = createWorkflowRunStore({ storage: { getItem: () => null, setItem } })

    store.save(createRun())

    expect(setItem).toHaveBeenCalledWith(WORKFLOW_RUN_STORAGE_KEY, expect.any(String))
  })
})
