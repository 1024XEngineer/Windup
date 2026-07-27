import { describe, expect, it } from 'vitest'

import {
  availableCommands,
  createWorkflowRun,
  fetchWorkflowRun,
  submitWorkflowStep,
  suggestNextCommand,
} from '@/entities'

/**
 * entities/workflow-run 的存取契约：创建后能用同一 runId 取回。
 * 只覆盖数据层，不渲染页面、不走路由——页面竖线尚未自动验证。
 */
describe('entities/workflow-run 存取契约', () => {
  it('创建后拿得到 runId，且用它取回的是同一份运行数据', async () => {
    const created = await createWorkflowRun({ projectId: 1, driver: 'ai', prompt: '像素小骑士' })
    expect(created.id).toBeTruthy()
    expect(created.projectId).toBe(1)
    expect(created.driver).toBe('ai')

    const loaded = await fetchWorkflowRun(created.id)
    expect(loaded.id).toBe(created.id)
    expect(loaded.steps.length).toBe(created.steps.length)
  })

  it('新建的工作流第一步只能生成母版', async () => {
    const run = await createWorkflowRun({ projectId: 1, driver: 'manual' })
    expect(availableCommands(run)).toEqual(['generate-template'])
  })

  it('AI 建议与手动命令共用同一提交接口推进运行', async () => {
    const manualRun = await createWorkflowRun({ projectId: 1, driver: 'manual' })
    const manuallyAdvanced = await submitWorkflowStep(manualRun.id, {
      kind: 'generate-template',
      description: '手动输入的母版描述',
    })
    expect(manuallyAdvanced.steps[0].status).toBe('done')

    const plan = { description: '像素小骑士', actionNames: ['行走'] }
    let run = await createWorkflowRun({ projectId: 1, driver: 'ai', prompt: plan.description })

    for (let index = 0; index < 5; index += 1) {
      const command = suggestNextCommand(run, plan)
      expect(command).not.toBeNull()
      run = await submitWorkflowStep(run.id, command!)
    }

    expect(run.status).toBe('completed')
    expect(run.currentStepId).toBeNull()
    expect(run.steps.map((step) => step.type)).toEqual([
      'generate-template',
      'confirm-template',
      'add-action',
      'generate-action',
    ])
    expect(suggestNextCommand(run, plan)).toBeNull()
  })

  it('取一个不存在的工作流会报错，不会返回空对象', async () => {
    await expect(fetchWorkflowRun('run-does-not-exist')).rejects.toThrow()
  })
})
