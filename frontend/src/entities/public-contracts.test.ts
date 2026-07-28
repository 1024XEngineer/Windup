import { describe, expectTypeOf, it } from 'vitest'

import { confirmBaseImage } from './index'
import type {
  Action,
  ActionTemplate,
  Character,
  CharacterPerspective,
  CharacterVariant,
  DirectionalMovement,
  Frame,
  Project,
  Task,
  WorkflowRun,
  WorkflowTaskLink,
} from './index'

describe('entities 公开契约', () => {
  it('动作携带播放帧率，Frame 的顺序由数组表达', () => {
    expectTypeOf<Action>().toHaveProperty('fps').toBeNumber()
    expectTypeOf<Action>().not.toHaveProperty('hasDisplacement')
    expectTypeOf<Frame>().not.toHaveProperty('index')
  })

  it('角色母版与动作模板使用不同概念', () => {
    expectTypeOf<Character>().toHaveProperty('variants').toEqualTypeOf<CharacterVariant[]>()
    expectTypeOf<Character>().not.toHaveProperty('baseImageUrl')
    expectTypeOf<CharacterVariant>().toHaveProperty('baseImageUrl').toEqualTypeOf<string | null>()
    expectTypeOf(confirmBaseImage).toEqualTypeOf<(variantId: string) => Promise<CharacterVariant>>()
    expectTypeOf<Action>().toHaveProperty('variantId').toBeString()
    expectTypeOf<Action>()
      .toHaveProperty('sourceWorkflowRunId')
      .toEqualTypeOf<WorkflowRun['id'] | null>()
    expectTypeOf<Action>().not.toHaveProperty('sourceWorkflowId')
  })

  it('系统模板与项目模板通过作用域区分归属', () => {
    type SystemTemplate = Extract<ActionTemplate, { scope: 'system' }>
    type ProjectTemplate = Extract<ActionTemplate, { scope: 'project' }>

    expectTypeOf<SystemTemplate>().toHaveProperty('projectId').toEqualTypeOf<null>()
    expectTypeOf<ProjectTemplate>().toHaveProperty('projectId').toBeString()
    expectTypeOf<ActionTemplate>().not.toHaveProperty('hasDisplacement')
  })

  it('异步任务提供可查询和恢复的完整快照', () => {
    expectTypeOf<Task>().toHaveProperty('id').toBeString()
    expectTypeOf<Task>().not.toHaveProperty('runId')
    expectTypeOf<Task>().not.toHaveProperty('revisionId')
    expectTypeOf<Task>().toHaveProperty('progress').toEqualTypeOf<number | null>()
    expectTypeOf<Task>().toHaveProperty('result').toBeUnknown()
    expectTypeOf<WorkflowTaskLink>().toEqualTypeOf<{
      taskId: string
      runId: string
      revisionId: string
      nodeId: string
    }>()
  })

  it('Project 在领域层使用字符串枚举，数字只保留在 DTO', () => {
    expectTypeOf<CharacterPerspective>().toEqualTypeOf<'side' | 'top-down' | 'isometric'>()
    expectTypeOf<DirectionalMovement>().toEqualTypeOf<'single' | 'four-way' | 'eight-way'>()
    expectTypeOf<Project>().toHaveProperty('perspective').toEqualTypeOf<CharacterPerspective>()
    expectTypeOf<Project>()
      .toHaveProperty('directionalMovement')
      .toEqualTypeOf<DirectionalMovement>()
  })
})
