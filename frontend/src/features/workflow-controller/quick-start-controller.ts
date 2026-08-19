import {
  ProjectNameConflictError,
  type GenerationApis,
  type MediaReference,
  type Project,
  type ProjectApis,
  type WorkflowNode,
  type WorkflowRun,
  type WorkflowRunApis,
} from '@/entities'

import {
  createWorkflowController,
  type CreateWorkflowControllerOptions,
  type WorkflowController,
} from './controller'

const PROJECT_NAME_MAX_LENGTH = 20
const QUICK_START_PROJECT_NAME_ATTEMPTS = 100

export type PrepareQuickStartProject = (
  prompt: string,
) => Promise<Pick<Project, 'id' | 'spriteSize'>>

export interface StartCharacterGenerationInput {
  prompt: string
}

export interface StartCharacterGenerationResult {
  runId: WorkflowRun['id']
}

export interface QuickStartWorkflowController {
  startCharacterGeneration(
    input: StartCharacterGenerationInput,
  ): Promise<StartCharacterGenerationResult>
}

interface QuickStartWorkflowControllerDependencies {
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  onAsyncError?: (error: Error) => void
  /** 单测可替换装配点；生产始终使用现有的一 Run 一 Controller 实现。 */
  createController?: (options: CreateWorkflowControllerOptions) => WorkflowController
}

export type CreateQuickStartWorkflowControllerOptions = QuickStartWorkflowControllerDependencies &
  (
    | {
        projectApis: Pick<ProjectApis, 'create'>
        prepareProject?: never
      }
    | {
        /** 已有 Quick Start 路径可注入同一项目命名策略，Controller 仍拥有调用时机。 */
        prepareProject: PrepareQuickStartProject
        projectApis?: never
      }
  )

function boundedDisplayName(value: string, maxLength: number): string {
  const characters = Array.from(value)
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength - 1).join('')}…`
    : characters.join('')
}

/** Quick Start 的两节点入口图；上传母版与纯文本入口共用同一份结构。 */
export function createQuickStartCharacterNodes(
  prompt: string,
  referenceMedia: readonly MediaReference[] = [],
): WorkflowNode[] {
  return [
    {
      id: 'character-setup',
      type: 'character-setup',
      status: 'active',
      phase: 'configuring',
      dependsOnNodeIds: [],
      generations: [],
      error: null,
      input: { prompt, referenceMedia: [...referenceMedia] },
    },
    {
      id: 'character-template',
      type: 'character-template',
      status: 'locked',
      phase: 'ready',
      dependsOnNodeIds: ['character-setup'],
      generations: [],
      error: null,
      selectedImageUrl: null,
    },
  ]
}

export function createAutoPrepareProject(
  projectApis: Pick<ProjectApis, 'create'>,
): PrepareQuickStartProject {
  return async (prompt) => {
    const normalizedPrompt = prompt.trim().replace(/\s+/gu, ' ') || '未命名项目'
    let lastConflict: unknown

    for (let sequence = 1; sequence <= QUICK_START_PROJECT_NAME_ATTEMPTS; sequence += 1) {
      const suffix = sequence === 1 ? '' : ` ${sequence}`
      const maxBaseLength = PROJECT_NAME_MAX_LENGTH - Array.from(suffix).length
      const base = boundedDisplayName(normalizedPrompt, maxBaseLength)

      try {
        const project = await projectApis.create({
          name: `${base}${suffix}`,
          perspective: 'side',
          directionalMovement: 'single',
          spriteSize: { width: 256, height: 256 },
        })
        return { id: project.id, spriteSize: project.spriteSize }
      } catch (error) {
        if (!(error instanceof ProjectNameConflictError)) throw error
        lastConflict = error
      }
    }

    throw lastConflict
  }
}

/**
 * 纯文本 Quick Start 的唯一写入口。
 *
 * 它只负责准备 Project、创建一条 Run 并通过现有 Controller 提交角色母版任务。
 * Generation 引用持久化后立即释放本地订阅；后续页面会按 runId 重新打开同一条 Run。
 */
export function createQuickStartWorkflowController({
  projectApis,
  prepareProject: providedPrepareProject,
  workflowRunApis,
  generationApis,
  onAsyncError = (error) => console.error('[quick-start-controller] 异步工作流错误', error),
  createController = createWorkflowController,
}: CreateQuickStartWorkflowControllerOptions): QuickStartWorkflowController {
  const prepareProject =
    providedPrepareProject ?? createAutoPrepareProject(projectApis as Pick<ProjectApis, 'create'>)

  return {
    async startCharacterGeneration({ prompt }) {
      const normalizedPrompt = prompt.trim()
      if (!normalizedPrompt) throw new Error('请先描述想要创建的角色')

      const project = await prepareProject(normalizedPrompt)
      const controller = createController({ workflowRunApis, generationApis, onAsyncError })
      try {
        await controller.create({
          projectId: project.id,
          nodes: createQuickStartCharacterNodes(normalizedPrompt),
        })
        await controller.generateCharacterTemplate('character-setup', {
          spriteWidth: project.spriteSize.width,
          spriteHeight: project.spriteSize.height,
        })
        return { runId: controller.getWorkflow().id }
      } finally {
        controller.dispose()
      }
    },
  }
}
