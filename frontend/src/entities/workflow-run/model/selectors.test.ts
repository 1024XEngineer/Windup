import { describe, expect, it } from 'vitest'

import { availableCommands, locateFrame, suggestNextCommand } from './selectors'
import type { WorkflowRun, WorkflowStep, WorkflowStepStatus, WorkflowStepType } from './types'

function step(
  id: string,
  type: WorkflowStepType,
  status: WorkflowStepStatus,
  actionId: number | null = null,
): WorkflowStep {
  return { id, type, status, actionId, taskId: null }
}

function run(steps: WorkflowStep[], overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    projectId: 1,
    characterId: null,
    driver: 'manual',
    status: 'running',
    currentStepId: null,
    steps,
    ...overrides,
  }
}

describe('availableCommands', () => {
  it('母版还没生成时，只能生成母版', () => {
    expect(availableCommands(run([step('s1', 'generate-template', 'pending')]))).toEqual([
      'generate-template',
    ])
  })

  it('有任务正在跑时，不允许发起任何新命令（防止连点产生重复任务）', () => {
    expect(availableCommands(run([step('s1', 'generate-template', 'running')]))).toEqual([])
  })

  it('母版生成完但没确认时，可以确认，也可以重新生成', () => {
    const result = availableCommands(run([step('s1', 'generate-template', 'done')]))
    expect(result).toContain('confirm-template')
    expect(result).toContain('generate-template')
  })

  it('母版确认后可以加动作，但还不能退回帧或收尾', () => {
    expect(
      availableCommands(
        run([step('s1', 'generate-template', 'done'), step('s2', 'confirm-template', 'done')]),
      ),
    ).toEqual(['add-action'])
  })

  it('加了动作还没生成时，可以发起生成', () => {
    expect(
      availableCommands(
        run([
          step('s1', 'generate-template', 'done'),
          step('s2', 'confirm-template', 'done'),
          step('s3', 'add-action', 'done', 10),
        ]),
      ),
    ).toContain('generate-action')
  })

  it('生成过动作之后，才能退回某一帧并收尾', () => {
    const result = availableCommands(
      run([
        step('s1', 'generate-template', 'done'),
        step('s2', 'confirm-template', 'done'),
        step('s3', 'add-action', 'done', 10),
        step('s4', 'generate-action', 'done', 10),
      ]),
    )
    expect(result).toContain('reject-frame')
    expect(result).toContain('finish')
  })

  it('已完成或已失败的工作流不接受任何命令', () => {
    expect(availableCommands(run([], { status: 'completed' }))).toEqual([])
    expect(availableCommands(run([], { status: 'failed' }))).toEqual([])
  })
})

describe('suggestNextCommand（AI 自动驱动）', () => {
  const plan = { description: '像素小骑士', actionNames: ['行走', '奔跑'] }

  it('从零开始时，第一步是生成母版', () => {
    expect(suggestNextCommand(run([step('s1', 'generate-template', 'pending')]), plan)).toEqual({
      kind: 'generate-template',
      description: '像素小骑士',
    })
  })

  it('母版好了就确认，不需要用户点', () => {
    expect(suggestNextCommand(run([step('s1', 'generate-template', 'done')]), plan)).toEqual({
      kind: 'confirm-template',
    })
  })

  it('确认后按计划逐个加动作，顺序与计划一致', () => {
    const base = [step('s1', 'generate-template', 'done'), step('s2', 'confirm-template', 'done')]
    expect(suggestNextCommand(run(base), plan)).toMatchObject({ kind: 'add-action', name: '行走' })
    expect(
      suggestNextCommand(run([...base, step('s3', 'add-action', 'done', 10)]), plan),
    ).toMatchObject({ kind: 'add-action', name: '奔跑' })
  })

  it('任务进行中时不给下一步，等它跑完', () => {
    expect(suggestNextCommand(run([step('s1', 'generate-template', 'running')]), plan)).toBeNull()
  })
})

describe('locateFrame', () => {
  it('能定位到生成某个动作的那一步，供审核台退回时跳回编辑器', () => {
    expect(locateFrame(run([step('s4', 'generate-action', 'done', 10)]), 10, 3)).toEqual({
      runId: 'run-1',
      stepId: 's4',
      actionId: 10,
      frameIndex: 3,
    })
  })

  it('找不到对应步骤时返回 null，不假装定位成功', () => {
    expect(locateFrame(run([]), 10, 3)).toBeNull()
  })
})
