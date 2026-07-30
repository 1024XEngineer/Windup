# 前端公开接口

本文件描述模块调用形状，不声明服务端 URL、请求外壳或错误格式。

## 命名约定

- TypeScript 类型和组件使用 PascalCase，字段、参数和方法使用 camelCase。
- URL 路径和源码目录使用 kebab-case，例如 `/quick-start`、`workflow-controller/`。
- 会进入业务 JSON 的枚举值统一使用 snake_case，例如 `create_character`、
  `character_template`、`north_east`。
- 服务端业务接口集合遵循导师约定统一使用 `*APIs`，不混用其他接口后缀。
- 所有容易混淆的模板和候选字段必须带业务前缀，例如 `actionTemplateId`、
  `characterTemplateCandidateId`。

## 业务 APIs

业务模块就近公开以下七组 APIs：

- `ProjectAPIs`：项目。
- `CharacterAPIs`：角色、造型和动作。
- `ActionTemplateAPIs`：动作模板。
- `WorkflowRunAPIs`：工作流持久化。
- `GenerationAPIs`：生成业务记录。
- `TaskAPIs`：异步任务快照。
- `PlaytestInspectionAPIs`：Playtest 独立核验记录。

它们只描述前端已确认的业务操作，具体实现等待对应后端合同。

```ts
interface ProjectAPIs {
  list(): Promise<Project[]>
  get(projectId: string): Promise<Project>
  create(input: CreateProjectInput): Promise<Project>
  update(projectId: string, input: UpdateProjectInput): Promise<Project>
  remove(projectId: string): Promise<void>
}

interface CharacterAPIs {
  get(characterId: string): Promise<Character>
  listByProject(projectId: string): Promise<Character[]>
  create(input: CreateCharacterInput): Promise<Character>
  update(character: Character): Promise<Character>
  confirmCharacterTemplate(
    characterId: string,
    input: ConfirmCharacterTemplateInput,
  ): Promise<Character>
  addAction(characterId: string, input: AddActionInput): Promise<Character>
}

interface ActionTemplateAPIs {
  listAvailable(projectId: string): Promise<ActionTemplate[]>
}

interface WorkflowRunAPIs {
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  get(runId: string): Promise<WorkflowRun>
  update(run: WorkflowRun): Promise<WorkflowRun>
}

interface GenerationAPIs {
  create(input: CreateGenerationInput): Promise<Generation>
  get(generationId: string): Promise<Generation>
}

interface TaskAPIs {
  get(taskId: string): Promise<Task>
}

interface PlaytestInspectionAPIs {
  getLatest(target: {
    characterId: string
    outfitId: string
  }): Promise<PlaytestInspection | null>
  record(input: RecordPlaytestInspectionInput): Promise<PlaytestInspection>
}
```

图片上传、审核、导出和事件传输的正式方法尚未冻结，本 PR 不提前声明。

## Workflow Controller

Workflow Controller 操作一份 WorkflowRun 数据，不按 next、restart 等方法拆模块。

```ts
interface WorkflowController {
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  getWorkflow(): WorkflowRun
  nextStep(): Promise<WorkflowRun>
  updateStep(input: UpdateWorkflowStepInput): Promise<WorkflowRun>
  restartFromStep(input: RestartWorkflowFromStepInput): Promise<WorkflowRun>
  interrupt(): Promise<WorkflowRun>
  resume(): Promise<WorkflowRun>
  applyServerResult(input: ApplyWorkflowServerResultInput): Promise<WorkflowRun>
}
```

步骤的当前数据保存在 `WorkflowStep.data`，当前步骤由 `WorkflowRevision.currentStepId` 明确指向。从历史步骤重新开始时追加 Revision，旧 Revision 保持只读；异步服务端结果必须携带发起请求时的 `revisionId`，不能污染重启后的新版本。如何清理后续步骤由后续实现 PR 完成。

## 关键术语

- `ActionTemplate`：动作模板，描述动作名称与提示词。
- `ActionSource`：动作来自 ActionTemplate，还是来自用户自定义提示词。
- `candidateCharacterTemplates`：生成出的角色母版候选。
- `characterTemplateCandidateId`：用户确认的具体角色母版候选 ID。
- `characterTemplateUrl`：用户确认的角色母版。
- `baseFrames`：母版确认后展开的多方向基础帧。
- `DirectionMode`：Project 要求单方向、四方向还是八方向资产。
- `SpriteDirection`：基础帧和动作序列共同使用的明确精灵朝向。
- `ActionSequence`：一个动作在某个精灵朝向下的完整帧序列。
- `Generation`：前端创建、查询和展示的生成业务记录。
- `Task`：服务端异步任务快照，不等于 WorkflowStep。
