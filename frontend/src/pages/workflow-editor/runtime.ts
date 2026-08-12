import type {
  Character,
  CharacterApis,
  GenerationApis,
  MediaApis,
  MediaReference,
  Project,
  ProjectApis,
  CharacterTemplateWorkflowNode,
  ReviewWorkflowNode,
  WorkflowRunApis,
} from '@/entities'
import { characterApis, createMediaApis, projectApis, workflowRunApis } from '@/entities'
import { createCharacterAssetPublisher } from '@/features/export'
import { createWorkflowController, type WorkflowController } from '@/features/workflow-controller'

export interface WorkflowEditorSession {
  controller: WorkflowController
  project: Project
  /** 后端用 workflow_run_id 建立的唯一角色；尚未产出正式角色时为 null。 */
  character: Character | null
  /** 确认身份母版，并在首次确认时创建可继续生成动作的 Character。 */
  confirmCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    selectedImageUrl: string,
  ): Promise<Character>
  /** 上传角色生成约束图；页面不接触 multipart 协议或用途枚举。 */
  uploadReferenceImage(file: File, signal?: AbortSignal): Promise<MediaReference>
  /** 幂等发布动作资产；审核节点仍由页面随后通过 Controller 推进。 */
  publishReviewedAction(reviewNodeId: ReviewWorkflowNode['id']): Promise<Character>
  subscribeErrors(listener: (error: Error) => void): () => void
  dispose(): void
}

export interface RealWorkflowEditorDependencies {
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  mediaApis: Pick<MediaApis, 'upload'>
  projectApis: Pick<ProjectApis, 'get'>
  characterApis: Pick<CharacterApis, 'listByProject' | 'create' | 'update'>
  onAsyncError(error: Error): void
}

/**
 * 页面只消费这一份正式会话：WorkflowRun 决定流程状态，Project / Character 只提供
 * 只读上下文，所有业务推进都交给同一个 WorkflowController。
 */
export async function createRealWorkflowEditorSession(
  runId: string,
  dependencies: RealWorkflowEditorDependencies,
): Promise<WorkflowEditorSession> {
  const workflow = await dependencies.workflowRunApis.get(runId)
  const [project, loadedCharacter] = await Promise.all([
    dependencies.projectApis.get(workflow.projectId),
    loadWorkflowCharacter(dependencies.characterApis, workflow.projectId, workflow.id),
  ])
  let currentCharacter = loadedCharacter
  const errorListeners = new Set<(error: Error) => void>()
  const reportAsyncError = (error: Error) => {
    try {
      dependencies.onAsyncError(error)
    } catch {
      // 错误上报器不能反过来破坏已经完成的 WorkflowRun 持久化。
    }
    for (const listener of errorListeners) {
      try {
        listener(error)
      } catch {
        // 页面卸载竞态或错误边界异常不应中断其他订阅者。
      }
    }
  }
  const controller = createWorkflowController({
    workflow,
    workflowRunApis: dependencies.workflowRunApis,
    generationApis: dependencies.generationApis,
    onAsyncError: reportAsyncError,
  })
  const publisher = createCharacterAssetPublisher(dependencies.characterApis)

  return {
    controller,
    project,
    character: loadedCharacter,
    uploadReferenceImage(file, signal) {
      return dependencies.mediaApis.upload(file, 'reference-image', signal)
    },
    async confirmCharacterTemplate(nodeId, selectedImageUrl) {
      const imageUrl = selectedImageUrl.trim()
      if (!imageUrl) throw new Error('必须选择角色母版')
      const currentWorkflow = controller.getWorkflow()
      const templateNode = currentWorkflow.nodes.find((node) => node.id === nodeId)
      if (
        !templateNode ||
        templateNode.type !== 'character-template' ||
        templateNode.status !== 'active' ||
        templateNode.phase !== 'selecting'
      ) {
        throw new Error('角色母版节点当前不能确认')
      }
      const setupNode = currentWorkflow.nodes.find(
        (node) =>
          templateNode.dependsOnNodeIds.includes(node.id) && node.type === 'character-setup',
      )
      if (!setupNode || setupNode.type !== 'character-setup') {
        throw new Error('角色母版缺少角色设定')
      }

      if (!currentCharacter) {
        currentCharacter = await dependencies.characterApis.create({
          projectId: currentWorkflow.projectId,
          workflowRunId: currentWorkflow.id,
          description: setupNode.input.prompt,
          referenceImageUrl: imageUrl,
        })
      }
      if (currentCharacter.outfits.length === 0) {
        currentCharacter = await dependencies.characterApis.update({
          ...currentCharacter,
          outfits: [
            {
              id: 'outfit-default',
              characterId: currentCharacter.id,
              name: '常态造型',
              description: null,
              previewUrl: imageUrl,
              actions: [],
            },
          ],
        })
      }

      await controller.confirmCharacterTemplate(nodeId, imageUrl)
      return currentCharacter
    },
    async publishReviewedAction(reviewNodeId) {
      if (!currentCharacter) throw new Error('当前 WorkflowRun 尚未关联 Character')
      const currentWorkflow = controller.getWorkflow()
      const reviewNode = currentWorkflow.nodes.find((node) => node.id === reviewNodeId)
      if (!reviewNode || reviewNode.type !== 'review') throw new Error('目标节点不是动作审核')
      if (reviewNode.dependsOnNodeIds.length !== 1) {
        throw new Error(`${reviewNode.id} 必须且只能依赖一个完整动画节点`)
      }
      const fullFrameNodeId = reviewNode.dependsOnNodeIds[0]!
      const generation = await controller.getGeneration(fullFrameNodeId, 'complete_animation')
      if (!generation) throw new Error('完整动画生成结果不存在')

      currentCharacter = await publisher.publishReviewedAction({
        character: currentCharacter,
        workflow: currentWorkflow,
        reviewNodeId,
        generation,
      })
      return currentCharacter
    },
    subscribeErrors(listener) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    dispose() {
      errorListeners.clear()
      controller.dispose()
    },
  }
}

/**
 * main 已提供真实 WorkflowRun、Project 与 Character 适配器；Generation 只有公开接口，
 * 尚无可合入的 HTTP 实现。这里明确拒绝生成，避免用演示数据污染正式 WorkflowRun。
 */
export function createDefaultRealWorkflowEditorSession(
  runId: string,
): Promise<WorkflowEditorSession> {
  return createRealWorkflowEditorSession(runId, {
    workflowRunApis,
    generationApis: createUnavailableGenerationApis(),
    mediaApis: createMediaApis(),
    projectApis,
    characterApis,
    onAsyncError: () => undefined,
  })
}

export function createUnavailableGenerationApis(): GenerationApis {
  const unavailable = () =>
    Promise.reject(new Error('GenerationApis 尚未接入真实后端，不能执行或恢复生成任务'))

  return {
    create: unavailable as GenerationApis['create'],
    get: unavailable,
    subscribe: () => () => undefined,
  }
}

async function loadWorkflowCharacter(
  apis: Pick<CharacterApis, 'listByProject'>,
  projectId: Project['id'],
  workflowRunId: string,
): Promise<Character | null> {
  const pageSize = 100
  const matches: Character[] = []

  for (let page = 1; ; page += 1) {
    const result = await apis.listByProject(projectId, { page, pageSize })
    matches.push(...result.items.filter((character) => character.workflowRunId === workflowRunId))
    if (matches.length > 1) {
      throw new Error(`WorkflowRun ${workflowRunId} 关联了多个角色，无法进入单角色画布`)
    }
    const totalPages = Math.ceil(result.total / result.pageSize)
    if (page >= totalPages || result.items.length === 0) break
  }

  return matches[0] ?? null
}
