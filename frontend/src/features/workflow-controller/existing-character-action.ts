import type {
  Character,
  CharacterApis,
  MediaReference,
  Outfit,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'

export interface ExistingCharacterActionTarget {
  readonly characterId: Character['id']
  readonly outfitId: Outfit['id']
}

interface ExistingCharacterActionDependencies {
  readonly characterApis: Pick<CharacterApis, 'get'>
  readonly workflowRunApis: Pick<WorkflowRunApis, 'create'>
}

export interface ExistingCharacterActionRun {
  readonly run: WorkflowRun
  readonly character: Character
  readonly outfit: Outfit
}

function existingCharacterNodes(character: Character, outfit: Outfit): WorkflowNode[] {
  const templateUrl = outfit.previewUrl
  if (!templateUrl) throw new Error('当前造型没有可用于生成动作的角色母版')
  const prompt = character.description?.trim() || character.name?.trim() || '现有角色'

  return [
    {
      id: 'character-setup',
      type: 'character-setup',
      status: 'passed',
      phase: 'completed',
      dependsOnNodeIds: [],
      generations: [],
      error: null,
      input: {
        characterId: character.id,
        prompt,
        referenceMedia: [templateUrl as MediaReference],
      },
    },
    {
      id: 'character-template',
      type: 'character-template',
      status: 'passed',
      phase: 'completed',
      dependsOnNodeIds: ['character-setup'],
      generations: [],
      error: null,
      selectedImageUrl: templateUrl,
    },
  ]
}

/** 为现有角色的新动作创建独立 Run；原角色创建 Run 保持只读。 */
export async function createExistingCharacterActionRun(
  target: ExistingCharacterActionTarget,
  dependencies: ExistingCharacterActionDependencies,
): Promise<ExistingCharacterActionRun> {
  const character = await dependencies.characterApis.get(target.characterId)
  const outfit = character.outfits.find((candidate) => candidate.id === target.outfitId)
  if (!outfit?.previewUrl) throw new Error('当前造型没有可用于生成动作的角色母版')

  const run = await dependencies.workflowRunApis.create({
    projectId: character.projectId,
    nodes: existingCharacterNodes(character, outfit),
  })
  return { run, character, outfit }
}
