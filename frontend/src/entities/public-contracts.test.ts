import { describe, expectTypeOf, it } from 'vitest'

import type {
  Action,
  ActionKind,
  ActionType,
  ActionTemplate,
  AddActionInput,
  BaseFrame,
  Character,
  CharacterRepository,
  CharacterTemplateCandidate,
  CharacterPerspective,
  ConfirmCharacterTemplateInput,
  CreateWorkflowRunInput,
  DirectionalMovement,
  Frame,
  FrameRootMotion,
  Outfit,
  PlaytestInspection,
  PlaytestInspectionRepository,
  PlaytestInspectionStatus,
  RecordPlaytestInspectionInput,
  Project,
  ProjectRepository,
  Task,
  TaskEvent,
  TaskEventSource,
  TaskRepository,
  TaskStatus,
  TaskType,
  WorkflowCommand,
  WorkflowRun,
  WorkflowRunPurpose,
  WorkflowTaskLink,
  WorkflowNode,
  WorkflowRevision,
  WorkflowRunStatus,
} from './index'

describe('entities 公开契约', () => {
  it('动作定义来源与业务语义是同时保留的独立维度', () => {
    expectTypeOf<ActionKind>().toEqualTypeOf<'preset' | 'custom'>()
    expectTypeOf<ActionType>().toEqualTypeOf<'walk' | 'idle' | 'attack' | 'jump' | 'custom'>()
    expectTypeOf<Pick<Action, 'kind' | 'type'>>().toEqualTypeOf<{
      kind: ActionKind
      type: ActionType
    }>()
  })

  it('动作公开逐帧时长、根位移和关键帧读取形状', () => {
    expectTypeOf<ActionType>().toEqualTypeOf<'walk' | 'idle' | 'attack' | 'jump' | 'custom'>()
    expectTypeOf<Action>().toHaveProperty('type').toEqualTypeOf<ActionType>()
    expectTypeOf<Action>().toHaveProperty('fps').toBeNumber()
    expectTypeOf<Action>().toHaveProperty('keyFrameIndex').toEqualTypeOf<number | null>()
    expectTypeOf<Action>().not.toHaveProperty('hasDisplacement')
    expectTypeOf<Frame>().not.toHaveProperty('index')
    expectTypeOf<Frame>().toHaveProperty('durationMs').toEqualTypeOf<number | null>()
    expectTypeOf<FrameRootMotion>().toEqualTypeOf<{ dx: number; dy: number }>()
    expectTypeOf<Frame>().toHaveProperty('rootMotion').toEqualTypeOf<FrameRootMotion | null>()
  })

  it('角色母版与动作模板使用不同概念', () => {
    expectTypeOf<Character>().toHaveProperty('outfits').toEqualTypeOf<Outfit[]>()
    expectTypeOf<CharacterTemplateCandidate>().toEqualTypeOf<{
      id: string
      imageUrl: string
      attemptId: string
    }>()
    expectTypeOf<Outfit>()
      .toHaveProperty('candidateCharacterTemplates')
      .toEqualTypeOf<CharacterTemplateCandidate[]>()
    expectTypeOf<Outfit>().toHaveProperty('characterTemplateUrl').toEqualTypeOf<string | null>()
    expectTypeOf<BaseFrame>().toEqualTypeOf<{ readonly imageUrl: string }>()
    expectTypeOf<Outfit>().toHaveProperty('baseFrames').toEqualTypeOf<readonly BaseFrame[]>()
    expectTypeOf<Outfit>().not.toHaveProperty('baseImageUrl')
    expectTypeOf<ConfirmCharacterTemplateInput>().toEqualTypeOf<{
      outfitId: string
      candidateId: string
    }>()
    expectTypeOf<CharacterRepository['update']>().toEqualTypeOf<
      (character: Character) => Promise<Character>
    >()
    expectTypeOf<CharacterRepository>().not.toHaveProperty('confirmCharacterTemplate')
    expectTypeOf<CharacterRepository>().not.toHaveProperty('addAction')
    expectTypeOf<Action>().toHaveProperty('outfitId').toBeString()
    expectTypeOf<Action>().not.toHaveProperty('sourceWorkflowRunId')
    expectTypeOf<Action>().not.toHaveProperty('sourceWorkflowId')
  })

  it('新增动作同时携带定义来源和业务语义', () => {
    type Preset = Extract<AddActionInput, { kind: 'preset' }>
    type Custom = Extract<AddActionInput, { kind: 'custom' }>

    expectTypeOf<Preset>().toHaveProperty('type').toEqualTypeOf<ActionType>()
    expectTypeOf<Preset>().toHaveProperty('actionTemplateId').toEqualTypeOf<ActionTemplate['id']>()
    expectTypeOf<Custom>().toHaveProperty('type').toEqualTypeOf<ActionType>()
    expectTypeOf<Custom>().not.toHaveProperty('actionTemplateId')
  })

  it('系统模板与项目模板通过作用域区分归属', () => {
    type SystemTemplate = Extract<ActionTemplate, { scope: 'system' }>
    type ProjectTemplate = Extract<ActionTemplate, { scope: 'project' }>

    expectTypeOf<SystemTemplate>().toHaveProperty('projectId').toEqualTypeOf<null>()
    expectTypeOf<ProjectTemplate>().toHaveProperty('projectId').toBeString()
    expectTypeOf<ActionTemplate>().toHaveProperty('prompt').toBeString()
    expectTypeOf<ActionTemplate>().not.toHaveProperty('previewImageUrl')
    expectTypeOf<ActionTemplate>().not.toHaveProperty('frameCount')
    expectTypeOf<ActionTemplate>().not.toHaveProperty('fps')
    expectTypeOf<ActionTemplate>().not.toHaveProperty('hasDisplacement')
  })

  it('异步任务提供可查询和恢复的完整快照', () => {
    expectTypeOf<TaskStatus>().toEqualTypeOf<'pending' | 'running' | 'completed' | 'failed'>()
    expectTypeOf<TaskType>().toEqualTypeOf<
      'character_template' | 'first_frame' | 'complete_animation'
    >()
    expectTypeOf<Task<'character_template'>>()
      .toHaveProperty('type')
      .toEqualTypeOf<'character_template'>()
    expectTypeOf<Task>().toHaveProperty('id').toBeString()
    expectTypeOf<Task>().not.toHaveProperty('runId')
    expectTypeOf<Task>().not.toHaveProperty('revisionId')
    expectTypeOf<Task>().not.toHaveProperty('progress')
    expectTypeOf<TaskEvent>().not.toHaveProperty('progress')
    expectTypeOf<Task>().toHaveProperty('result').toBeUnknown()
    expectTypeOf<TaskEvent<'complete_animation'>>()
      .toHaveProperty('type')
      .toEqualTypeOf<'complete_animation'>()
    expectTypeOf<WorkflowTaskLink>().toEqualTypeOf<{
      taskId: string
      runId: string
      revisionId: string
      nodeId: string
    }>()
    expectTypeOf<TaskRepository['get']>().toEqualTypeOf<(taskId: Task['id']) => Promise<Task>>()
    expectTypeOf<TaskRepository['cancel']>().toEqualTypeOf<(taskId: Task['id']) => Promise<void>>()
    expectTypeOf<TaskEventSource['subscribe']>().toEqualTypeOf<
      (taskId: Task['id'], onEvent: (event: TaskEvent) => void) => () => void
    >()
  })

  it('WorkflowNode 不复制顺序或后端质检计数', () => {
    expectTypeOf<WorkflowNode>().not.toHaveProperty('order')
    expectTypeOf<WorkflowNode>().not.toHaveProperty('qualityFailureCount')
  })

  it('用户主动停止是独立的 WorkflowRun 历史状态', () => {
    expectTypeOf<WorkflowRunStatus>().toEqualTypeOf<
      'active' | 'interrupted' | 'completed' | 'failed'
    >()
  })

  it('WorkflowRun 能表达新建角色与已有角色加动作两种启动意图', () => {
    expectTypeOf<WorkflowRunPurpose>().toEqualTypeOf<'create_character' | 'add_action'>()
    expectTypeOf<WorkflowRun>().toHaveProperty('purpose').toEqualTypeOf<WorkflowRunPurpose>()
    expectTypeOf<WorkflowRun>().toHaveProperty('outfitId').toEqualTypeOf<string | null>()

    type AddActionRun = Extract<CreateWorkflowRunInput, { purpose: 'add_action' }>
    expectTypeOf<AddActionRun>().toMatchTypeOf<{
      characterId: string
      outfitId: string
      characterTemplateUrl: string
      baseFrameUrls: readonly string[]
    }>()
  })

  it('Project 领域骨架只定义前端字符串枚举，不预设后端数字映射', () => {
    expectTypeOf<ProjectRepository>().not.toHaveProperty('adapterKind')
    expectTypeOf<CharacterPerspective>().toEqualTypeOf<'side' | 'top-down' | 'isometric'>()
    expectTypeOf<DirectionalMovement>().toEqualTypeOf<'single' | 'four-way' | 'eight-way'>()
    expectTypeOf<Project>().toHaveProperty('perspective').toEqualTypeOf<CharacterPerspective>()
    expectTypeOf<Project>()
      .toHaveProperty('directionalMovement')
      .toEqualTypeOf<DirectionalMovement>()
    expectTypeOf<Project>().not.toHaveProperty('workflowId')
  })

  it('流程重启不再伪装成 Repository 可直接提交的命令', () => {
    type RestartCommand = Extract<WorkflowCommand, { kind: 'restart-from-node' }>
    expectTypeOf<RestartCommand>().toBeNever()
  })

  it('Playtest 结论是独立记录，不写入 WorkflowRevision', () => {
    expectTypeOf<PlaytestInspectionStatus>().toEqualTypeOf<'passed' | 'issues_found'>()
    expectTypeOf<PlaytestInspection>().toEqualTypeOf<{
      id: string
      characterId: string
      outfitId: string
      source: { runId: string; revisionId: string } | null
      status: PlaytestInspectionStatus
      createdAt: string
      updatedAt: string
    }>()
    expectTypeOf<PlaytestInspectionRepository['record']>().toEqualTypeOf<
      (input: RecordPlaytestInspectionInput) => Promise<PlaytestInspection>
    >()
    expectTypeOf<PlaytestInspectionRepository['getLatest']>().toEqualTypeOf<
      (target: { characterId: string; outfitId: string }) => Promise<PlaytestInspection | null>
    >()
    expectTypeOf<WorkflowRevision>().not.toHaveProperty('playtestStatus')
  })
})
