import { createApiClient, getApiAccessToken } from '@/shared/api'
import type { Paged, PageQuery } from '@/shared/pagination'

/** PR #75 将动作类型定义为字符串；已知类型之外的后端扩展也应原样保留。 */
export type ActionType = string

export const CHARACTER_STATUS = {
  DRAFT: 0,
  PUBLISHED: 1,
  UNKNOWN: 'unknown',
} as const

export type CharacterPublicationStatus =
  | typeof CHARACTER_STATUS.DRAFT
  | typeof CHARACTER_STATUS.PUBLISHED
export type CharacterStatus = CharacterPublicationStatus | typeof CHARACTER_STATUS.UNKNOWN

export interface Frame {
  /** 使用后端显式返回的帧序号，不用数组下标替代。 */
  index: number
  imageUrl: string
  /** null 时才按所属 Action.fps 计算等时长。 */
  durationMs: number | null
}

export interface Action {
  /** Action 只在所属 Outfit 内唯一。 */
  id: string
  outfitId: Outfit['id']
  name: string
  type: ActionType
  loop: boolean
  fps: number
  frameCount: number
  frames: Frame[]
}

export interface Outfit {
  /** Outfit 只在所属 Character 内唯一。 */
  id: string
  characterId: Character['id']
  name: string
  description: string | null
  previewUrl: string | null
  /** 该造型已确认的绑骨 3D 模型；null = 三渲二在此造型上不可用，动作生成走 i2v。 */
  model3dUrl: string | null
  actions: Action[]
}

/** 项目下的角色资产；造型、动作与帧来自同一份 character_data。 */
export interface Character {
  id: string
  projectId: string
  /** 角色由哪一条制作流程产出；Workflow Editor 以它落实单画布单角色。 */
  workflowRunId: string
  name: string | null
  description: string | null
  referenceImageUrl: string | null
  /** character_data.version，更新整棵资产树时必须原样带回。 */
  dataVersion: number
  status: CharacterStatus
  outfits: Outfit[]
}

/** 创建 Character 记录的字段；生成流程由 Workflow Editor 负责。 */
export interface CreateCharacterInput {
  projectId: string
  workflowRunId: string
  name?: string | null
  description?: string | null
  referenceImageUrl?: string | null
}

/**
 * Character 对应的一组后端接口。
 * Outfit、Action、Frame 没有独立端点，更新时随 Character 整棵提交。
 */
export interface CharacterApis {
  get(id: Character['id']): Promise<Character>
  listByProject(projectId: string, query?: CharacterPageQuery): Promise<Paged<Character>>
  create(input: CreateCharacterInput): Promise<Character>
  update(character: Character): Promise<Character>
  remove(id: Character['id']): Promise<void>
}

export interface CharacterPageQuery extends PageQuery {
  status?: CharacterPublicationStatus
  signal?: AbortSignal
}

interface CharacterFrameDto {
  index: number
  image_url: string
  duration_ms: number | null
}

interface CharacterActionDto {
  id: string
  type: string
  name: string
  loop: boolean
  fps: number
  frame_count: number
  frames: CharacterFrameDto[]
}

interface CharacterOutfitDto {
  id: string
  name: string
  description: string | null
  preview_url: string | null
  model_3d_url?: string | null
  actions: CharacterActionDto[]
}

interface CharacterDataDto {
  version: number
  outfits: CharacterOutfitDto[]
}

interface CharacterDto {
  id: number
  project_id: number
  workflow_run_id: number
  name: string | null
  description: string | null
  reference_image_url: string | null
  character_data: CharacterDataDto
  status: number
}

function toBackendId(value: string, field: string): number {
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  throw new TypeError(`${field} 必须是正整数 ID`)
}

function mapCharacterStatus(status: number): CharacterStatus {
  if (status === CHARACTER_STATUS.DRAFT || status === CHARACTER_STATUS.PUBLISHED) return status
  return CHARACTER_STATUS.UNKNOWN
}

function mapFrame(dto: CharacterFrameDto): Frame {
  return {
    index: dto.index,
    imageUrl: dto.image_url,
    durationMs: dto.duration_ms,
  }
}

function mapAction(dto: CharacterActionDto, outfitId: string): Action {
  return {
    id: dto.id,
    outfitId,
    name: dto.name,
    type: dto.type,
    loop: dto.loop,
    fps: dto.fps,
    frameCount: dto.frame_count,
    frames: dto.frames.map(mapFrame),
  }
}

function mapOutfit(dto: CharacterOutfitDto, characterId: string): Outfit {
  return {
    id: dto.id,
    characterId,
    name: dto.name,
    description: dto.description,
    previewUrl: dto.preview_url,
    model3dUrl: dto.model_3d_url ?? null,
    actions: dto.actions.map((action) => mapAction(action, dto.id)),
  }
}

function mapCharacter(dto: CharacterDto): Character {
  const characterId = String(dto.id)
  return {
    id: characterId,
    projectId: String(dto.project_id),
    workflowRunId: String(dto.workflow_run_id),
    name: dto.name,
    description: dto.description,
    referenceImageUrl: dto.reference_image_url,
    dataVersion: dto.character_data.version,
    status: mapCharacterStatus(dto.status),
    outfits: dto.character_data.outfits.map((outfit) => mapOutfit(outfit, characterId)),
  }
}

function toFrameDto(frame: Frame): CharacterFrameDto {
  return {
    index: frame.index,
    image_url: frame.imageUrl,
    duration_ms: frame.durationMs,
  }
}

function toActionDto(action: Action): CharacterActionDto {
  return {
    id: action.id,
    type: action.type,
    name: action.name,
    loop: action.loop,
    fps: action.fps,
    frame_count: action.frameCount,
    frames: action.frames.map(toFrameDto),
  }
}

function toOutfitDto(outfit: Outfit): CharacterOutfitDto {
  return {
    id: outfit.id,
    name: outfit.name,
    description: outfit.description,
    preview_url: outfit.previewUrl,
    model_3d_url: outfit.model3dUrl,
    actions: outfit.actions.map(toActionDto),
  }
}

function getApiClient() {
  return createApiClient({ getAccessToken: getApiAccessToken })
}

export const characterApis: CharacterApis = {
  async get(id) {
    return mapCharacter(
      await getApiClient().request<CharacterDto>(`/characters/${encodeURIComponent(id)}`),
    )
  },

  async listByProject(projectId, query = {}) {
    const result = await getApiClient().requestList<CharacterDto>('/characters', {
      signal: query.signal,
      query: {
        project_id: toBackendId(projectId, 'projectId'),
        page: query.page,
        page_size: query.pageSize,
        status: query.status,
      },
    })
    return { ...result, items: result.items.map(mapCharacter) }
  },

  async create(input) {
    const dto = await getApiClient().request<CharacterDto>('/characters', {
      method: 'POST',
      json: {
        project_id: toBackendId(input.projectId, 'projectId'),
        workflow_run_id: toBackendId(input.workflowRunId, 'workflowRunId'),
        name: input.name,
        description: input.description,
        reference_image_url: input.referenceImageUrl,
      },
    })
    return mapCharacter(dto)
  },

  async update(character) {
    const dto = await getApiClient().request<CharacterDto>(
      `/characters/${encodeURIComponent(character.id)}`,
      {
        method: 'PATCH',
        json: {
          name: character.name,
          description: character.description,
          reference_image_url: character.referenceImageUrl,
          character_data: {
            version: character.dataVersion,
            outfits: character.outfits.map(toOutfitDto),
          },
        },
      },
    )
    return mapCharacter(dto)
  },

  async remove(id) {
    await getApiClient().request<null>(`/characters/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  },
}
