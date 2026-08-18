import type {
  Character,
  CharacterApis,
  CharacterSetupWorkflowNode,
  CharacterTemplateWorkflowNode,
  WorkflowRun,
} from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'

interface CharacterTemplateConfirmerDependencies {
  controller: WorkflowController
  characterApis: Pick<CharacterApis, 'create' | 'update' | 'remove'>
  getCurrentCharacter(): Character | null
  setCurrentCharacter(character: Character): void
  shouldRollbackWorkflowChange(isPersisted: (latest: WorkflowRun) => boolean): Promise<boolean>
  reportAsyncError(error: Error): void
}

interface CharacterTemplateContext {
  imageUrl: string
  setupNode: CharacterSetupWorkflowNode
  workflow: WorkflowRun
}

interface CharacterWrite {
  original: Character | null
  next: Character | null
  created: boolean
  updatedExisting: boolean
}

export function createCharacterTemplateConfirmer(
  dependencies: CharacterTemplateConfirmerDependencies,
) {
  return async (
    nodeId: CharacterTemplateWorkflowNode['id'],
    selectedImageUrl: string,
  ): Promise<Character> => {
    const context = resolveCharacterTemplateContext(
      dependencies.controller.getWorkflow(),
      nodeId,
      selectedImageUrl,
    )
    const write: CharacterWrite = {
      original: cloneCharacter(dependencies.getCurrentCharacter()),
      next: dependencies.getCurrentCharacter(),
      created: false,
      updatedExisting: false,
    }

    try {
      await prepareCharacter(dependencies.characterApis, context, write)
      await dependencies.controller.confirmCharacterTemplate(
        nodeId,
        context.imageUrl,
        write.next!.id,
      )
      dependencies.setCurrentCharacter(write.next!)
      return write.next!
    } catch (cause) {
      await reconcileCharacterWrite(dependencies, context, nodeId, write)
      throw cause
    }
  }
}

function resolveCharacterTemplateContext(
  workflow: WorkflowRun,
  nodeId: CharacterTemplateWorkflowNode['id'],
  selectedImageUrl: string,
): CharacterTemplateContext {
  const imageUrl = selectedImageUrl.trim()
  if (!imageUrl) throw new Error('必须选择角色母版')

  const templateNode = workflow.nodes.find((node) => node.id === nodeId)
  if (
    !templateNode ||
    templateNode.type !== 'character-template' ||
    templateNode.status !== 'active' ||
    templateNode.phase !== 'selecting'
  ) {
    throw new Error('角色母版节点当前不能确认')
  }

  const setupNode = workflow.nodes.find(
    (node) => templateNode.dependsOnNodeIds.includes(node.id) && node.type === 'character-setup',
  )
  if (!setupNode || setupNode.type !== 'character-setup') {
    throw new Error('角色母版缺少角色设定')
  }
  return { imageUrl, setupNode, workflow }
}

async function prepareCharacter(
  characterApis: CharacterTemplateConfirmerDependencies['characterApis'],
  context: CharacterTemplateContext,
  write: CharacterWrite,
) {
  if (!write.next) {
    write.next = await characterApis.create({
      projectId: context.workflow.projectId,
      workflowRunId: context.workflow.id,
      description: context.setupNode.input.prompt,
      referenceImageUrl: context.imageUrl,
    })
    write.created = true
  }
  if (write.next.outfits.length > 0) return

  write.next = await characterApis.update({
    ...write.next,
    outfits: [
      {
        id: 'outfit-default',
        characterId: write.next.id,
        name: '常态造型',
        description: null,
        previewUrl: context.imageUrl,
        actions: [],
      },
    ],
  })
  write.updatedExisting = !write.created
}

async function reconcileCharacterWrite(
  dependencies: CharacterTemplateConfirmerDependencies,
  context: CharacterTemplateContext,
  nodeId: CharacterTemplateWorkflowNode['id'],
  write: CharacterWrite,
) {
  const shouldRollback = await dependencies.shouldRollbackWorkflowChange((latest) => {
    const latestTemplate = latest.nodes.find((node) => node.id === nodeId)
    const latestSetup = latest.nodes.find((node) => node.id === context.setupNode.id)
    return (
      latestTemplate?.type === 'character-template' &&
      latestTemplate.status === 'passed' &&
      latestTemplate.selectedImageUrl === context.imageUrl &&
      latestSetup?.type === 'character-setup' &&
      latestSetup.input.characterId === write.next?.id
    )
  })
  if (!shouldRollback) return

  try {
    if (write.created && write.next) {
      await dependencies.characterApis.remove(write.next.id)
    } else if (write.updatedExisting && write.original && write.next) {
      dependencies.setCurrentCharacter(
        await dependencies.characterApis.update({
          ...write.original,
          dataVersion: write.next.dataVersion,
        }),
      )
    }
  } catch (rollbackCause) {
    dependencies.reportAsyncError(
      rollbackCause instanceof Error ? rollbackCause : new Error('母版确认冲突后恢复角色资产失败'),
    )
  }
}

function cloneCharacter(character: Character | null) {
  return character ? structuredClone(character) : null
}
