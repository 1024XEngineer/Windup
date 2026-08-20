import type {
  ActionPreset,
  Character,
  CharacterApis,
  GenerationApis,
  MediaApis,
  MediaReference,
  Project,
  ProjectApis,
  CharacterTemplateWorkflowNode,
  Render3DApis,
  ReviewWorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import {
  actionPresetApis,
  characterApis,
  createAuthenticatedGenerationApis,
  createMediaApis,
  projectApis,
  render3DApis,
  workflowRunApis,
} from '@/entities'
import { createCharacterAssetPublisher } from '@/features/export'
import { createWorkflowController, type WorkflowController } from '@/features/workflow-controller'
import { createCharacterTemplateConfirmer } from './character-template-confirmation'

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
  /** 幂等发布动作资产，并与审核节点的保存作为一个用户命令处理。 */
  publishReviewedAction(reviewNodeId: ReviewWorkflowNode['id']): Promise<Character>
  /**
   * 母版预检与建 3D 资产。两者都挂在会话上而不是页面直连适配器，理由与其余能力一致：
   * 页面只消费会话，替身注入才有单一入口。
   */
  render3d: Render3DApis
  subscribeErrors(listener: (error: Error) => void): () => void
  dispose(): void
}

export interface RealWorkflowEditorDependencies {
  workflowRunApis: WorkflowRunApis
  generationApis: GenerationApis
  mediaApis: Pick<MediaApis, 'upload'>
  projectApis: Pick<ProjectApis, 'get'>
  characterApis: Pick<CharacterApis, 'get' | 'listByProject' | 'create' | 'update' | 'remove'>
  render3d: Render3DApis
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
  async function shouldRollbackWorkflowChange(isPersisted: (latest: WorkflowRun) => boolean) {
    try {
      return !isPersisted(await dependencies.workflowRunApis.get(workflow.id))
    } catch (reconcileCause) {
      reportAsyncError(
        reconcileCause instanceof Error
          ? reconcileCause
          : new Error('WorkflowRun 保存结果对账失败'),
      )
      // 无法确认 PATCH 是否已落库时保留幂等资产，避免删掉已被 Run 引用的数据。
      return false
    }
  }

  async function restorePublishedAction(
    original: Character,
    published: Character,
    actionId: string,
  ) {
    try {
      return await dependencies.characterApis.update({
        ...original,
        dataVersion: published.dataVersion,
      })
    } catch {
      // Character 又被并发更新时，在最新资产树上只恢复本命令触及的 Action。
      const latest = await dependencies.characterApis.get(original.id)
      const originalAction = original.outfits
        .flatMap((outfit) => outfit.actions)
        .find((action) => action.id === actionId)
      return dependencies.characterApis.update({
        ...latest,
        outfits: latest.outfits.map((outfit) => ({
          ...outfit,
          actions: [
            ...outfit.actions.filter((action) => action.id !== actionId),
            ...(originalAction?.outfitId === outfit.id ? [originalAction] : []),
          ],
        })),
      })
    }
  }

  const confirmCharacterTemplate = createCharacterTemplateConfirmer({
    controller,
    characterApis: dependencies.characterApis,
    getCurrentCharacter: () => currentCharacter,
    setCurrentCharacter: (character) => {
      currentCharacter = character
    },
    shouldRollbackWorkflowChange,
    reportAsyncError,
  })

  return {
    controller,
    project,
    character: loadedCharacter,
    render3d: dependencies.render3d,
    uploadReferenceImage(file, signal) {
      return dependencies.mediaApis.upload(file, 'reference-image', signal)
    },
    confirmCharacterTemplate,
    async publishReviewedAction(reviewNodeId) {
      if (!currentCharacter) throw new Error('当前 WorkflowRun 尚未关联 Character')
      const currentWorkflow = controller.getWorkflow()
      const reviewNode = currentWorkflow.nodes.find((node) => node.id === reviewNodeId)
      if (!reviewNode || reviewNode.type !== 'review') throw new Error('目标节点不是动作审核')
      if (reviewNode.dependsOnNodeIds.length !== 1) {
        throw new Error(`${reviewNode.id} 必须且只能依赖一个完整动画节点`)
      }
      const fullFrameNodeId = reviewNode.dependsOnNodeIds[0]!
      const fullFrameNode = currentWorkflow.nodes.find((node) => node.id === fullFrameNodeId)
      const methodNode = currentWorkflow.nodes.find((node) =>
        fullFrameNode?.dependsOnNodeIds.includes(node.id),
      )
      const firstFrameNode = currentWorkflow.nodes.find((node) =>
        methodNode?.dependsOnNodeIds.includes(node.id),
      )
      if (!firstFrameNode || firstFrameNode.type !== 'action-first-frame') {
        throw new Error('完整动画缺少动作首帧节点')
      }
      const generation = await controller.getGeneration(fullFrameNodeId, 'complete_animation')
      if (!generation) throw new Error('完整动画生成结果不存在')

      const originalCharacter = structuredClone(currentCharacter)
      const publishedCharacter = await publisher.publishReviewedAction({
        character: originalCharacter,
        workflow: currentWorkflow,
        reviewNodeId,
        generation,
      })
      try {
        await controller.approveReview(reviewNodeId)
        currentCharacter = publishedCharacter
        return publishedCharacter
      } catch (cause) {
        const shouldRollback = await shouldRollbackWorkflowChange((latest) => {
          const latestReview = latest.nodes.find((node) => node.id === reviewNodeId)
          return latestReview?.type === 'review' && latestReview.status === 'passed'
        })
        if (shouldRollback) {
          try {
            currentCharacter = await restorePublishedAction(
              originalCharacter,
              publishedCharacter,
              firstFrameNode.id,
            )
          } catch (rollbackCause) {
            currentCharacter = publishedCharacter
            reportAsyncError(
              rollbackCause instanceof Error
                ? rollbackCause
                : new Error('审核冲突后恢复角色资产失败'),
            )
          }
        }
        throw cause
      }
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

/** 使用生产 Generation 适配器恢复并推进单条 WorkflowRun。 */
export function createDefaultRealWorkflowEditorSession(
  runId: string,
): Promise<WorkflowEditorSession> {
  return createRealWorkflowEditorSession(runId, {
    workflowRunApis,
    generationApis: createAuthenticatedGenerationApis(),
    mediaApis: createMediaApis(),
    projectApis,
    characterApis,
    render3d: render3DApis,
    onAsyncError: () => undefined,
  })
}

/**
 * 读后端的动作预设。和会话走同一条注入路径 —— 页面不直连适配器，替身注入只有这一个入口。
 */
export function loadDefaultActionPresets(signal?: AbortSignal): Promise<ActionPreset[]> {
  return actionPresetApis.list(signal)
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
