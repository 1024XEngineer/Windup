import { describe, expectTypeOf, it } from 'vitest'

import type { WorkflowRunReader, WorkflowRunRepository } from './repository'
import type { WorkflowRun } from './types'

describe('WorkflowRunRepository 契约', () => {
  it('只负责异步存取，不执行流程命令或暴露 Adapter 类型', () => {
    expectTypeOf<WorkflowRunRepository>().not.toHaveProperty('adapterKind')
    expectTypeOf<WorkflowRunRepository>().not.toHaveProperty('submit')
    expectTypeOf<ReturnType<WorkflowRunRepository['create']>>().toEqualTypeOf<
      Promise<WorkflowRun>
    >()
    expectTypeOf<ReturnType<WorkflowRunRepository['get']>>().toEqualTypeOf<
      Promise<WorkflowRun | null>
    >()
    expectTypeOf<ReturnType<WorkflowRunRepository['save']>>().toEqualTypeOf<Promise<void>>()
  })

  it('页面读取端口不能创建或保存流程', () => {
    expectTypeOf<WorkflowRunReader>().toHaveProperty('get')
    expectTypeOf<WorkflowRunReader>().not.toHaveProperty('create')
    expectTypeOf<WorkflowRunReader>().not.toHaveProperty('save')
  })
})
