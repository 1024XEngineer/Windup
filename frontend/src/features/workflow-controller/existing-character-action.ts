import type {
  Character,
  CharacterApis,
  MediaReference,
  Outfit,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunApis,
} from '@/entities'
import { characterTemplateImages } from '@/entities'

const MISSING_TEMPLATE_MESSAGE = '当前造型还没有可用的角色母版，请先完成定妆再生成动作'

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
  const selectedImages = characterTemplateImages(character.templates)
  const templateUrl = selectedImages.east ?? outfit.previewUrl ?? character.referenceImageUrl
  if (!templateUrl) throw new Error(MISSING_TEMPLATE_MESSAGE)
  if (!selectedImages.east) selectedImages.east = templateUrl
  const prompt = character.description?.trim() || character.name?.trim() || '现有角色'
  const referenceMedia = [...new Set(Object.values(selectedImages))] as MediaReference[]

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
        referenceMedia,
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
      selectedImages,
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
  if (!outfit) throw new Error(MISSING_TEMPLATE_MESSAGE)

  const run = await dependencies.workflowRunApis.create({
    projectId: character.projectId,
    nodes: existingCharacterNodes(character, outfit),
  })
  return { run, character, outfit }
}
