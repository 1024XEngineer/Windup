import { describe, expect, it } from 'vitest'

import type { CreateProjectInput, CreateWorkflowRunInput, Project, WorkflowRun } from '@/entities'
import { createMvpQuickStartProjectPlanner, createQuickStartStarter } from './index'

const plannedProject: CreateProjectInput = {
  name: '像素骑士-abc123',
  perspective: 'side',
  directionalMovement: 'four-way',
  spriteSize: { width: 64, height: 64 },
  gameStyle: null,
  sampleImageUrl: null,
}

const project: Project = {
  id: 'project-42',
  ownerId: 'user-1',
  workflowId: null,
  name: plannedProject.name,
  perspective: plannedProject.perspective,
  directionalMovement: plannedProject.directionalMovement,
  spriteSize: plannedProject.spriteSize,
  gameStyle: null,
  sampleImageUrl: null,
  createdAt: '2026-07-28T08:00:00.000Z',
  updatedAt: '2026-07-28T08:00:00.000Z',
}

const run: WorkflowRun = {
  id: 'run-1',
  projectId: project.id,
  characterId: null,
  driver: 'ai',
  status: 'active',
  currentRevisionId: 'revision-1',
  revisions: [
    {
      id: 'revision-1',
      basedOnRevisionId: null,
      restartNodeId: null,
      status: 'active',
      nodes: [
        {
          id: 'node-asset-1',
          type: 'asset',
          order: 0,
          status: 'active',
          input: { prompt: '像素骑士' },
          output: null,
          referenceNodeIds: [],
          qualityFailureCount: 0,
        },
      ],
      generationStatus: 'not_started',
      exportStatus: 'not_exported',
      playtestStatus: 'not_tested',
      createdAt: '2026-07-28T08:00:00.000Z',
    },
  ],
  prompt: '像素骑士',
}

describe('Quick Start 启动用例', () => {
  it('先创建 Project，再用返回的 Project ID 创建统一 WorkflowRun', async () => {
    const calls: string[] = []
    let workflowInput: CreateWorkflowRunInput | null = null
    const startQuickStart = createQuickStartStarter({
      async planProject() {
        calls.push('plan-project')
        return plannedProject
      },
      async createProject(input) {
        calls.push('create-project')
        expect(input).toEqual(plannedProject)
        return project
      },
      async createWorkflowRun(input) {
        calls.push('create-workflow-run')
        workflowInput = input
        return run
      },
    })

    const result = await startQuickStart({ prompt: '  像素骑士  ' })

    expect(calls).toEqual(['plan-project', 'create-project', 'create-workflow-run'])
    expect(workflowInput).toEqual({
      projectId: 'project-42',
      driver: 'ai',
      prompt: '像素骑士',
    })
    expect(result).toEqual({ project, run })
  })

  it('Project 创建失败时不创建孤立 WorkflowRun', async () => {
    let workflowCreateCount = 0
    const startQuickStart = createQuickStartStarter({
      async planProject() {
        return plannedProject
      },
      async createProject() {
        throw new Error('项目服务不可用')
      },
      async createWorkflowRun() {
        workflowCreateCount += 1
        return run
      },
    })

    await expect(startQuickStart({ prompt: '像素骑士' })).rejects.toThrow('项目服务不可用')
    expect(workflowCreateCount).toBe(0)
  })
})

describe('Quick Start MS2 Project Planner', () => {
  it('生成不超过 20 字符的唯一名称并补齐当前项目默认约束', async () => {
    const planProject = createMvpQuickStartProjectPlanner(() => 'abc123')

    await expect(planProject({ prompt: '12345678901234567890' })).resolves.toEqual({
      name: '1234567890123-abc123',
      perspective: 'side',
      directionalMovement: 'four-way',
      spriteSize: { width: 64, height: 64 },
      gameStyle: null,
      sampleImageUrl: null,
    })
  })
})
