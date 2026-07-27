import { describe, expect, it } from 'vitest'

import { availableCommands, createWorkflowRun, fetchWorkflowRun } from '@/entities'

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

  it('取一个不存在的工作流会报错，不会返回空对象', async () => {
    await expect(fetchWorkflowRun('run-does-not-exist')).rejects.toThrow()
  })
})
