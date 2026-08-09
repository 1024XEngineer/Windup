import { createApiClient, getApiAccessToken } from '@/shared/api'
import type { Paged, PageQuery } from '@/shared/pagination'

/** PR #75 将动作类型定义为字符串；已知类型之外的后端扩展也应原样保留。 */
export type ActionType = string

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
  actions: Action[]
}

/** 项目下的角色资产；造型、动作与帧来自同一份 character_data。 */
export interface Character {
  id: string
  projectId: string
  name: string | null
  description: string | null
  referenceImageUrl: string | null
  /** character_data.version，更新整棵资产树时必须原样带回。 */
  dataVersion: number
  status: number
  outfits: Outfit[]
}

/**
 * 当前后端没有草稿/已发布字段，因此以至少一条包含真实帧的动作作为发布判定。
 * 后端补充显式发布状态后，只需要替换这一处规则。
 */
export function isPublishedCharacter(character: Character): boolean {
  return character.outfits.some((outfit) =>
    outfit.actions.some((action) => action.frames.length > 0),
  )
}

/** 创建 Character 记录的字段；生成流程由 Workflow Editor 负责。 */
export interface CreateCharacterInput {
  projectId: string
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
  listByProject(projectId: string, query?: PageQuery): Promise<Paged<Character>>
  create(input: CreateCharacterInput): Promise<Character>
  update(character: Character): Promise<Character>
  remove(id: Character['id']): Promise<void>
}

/**
 * 读取项目下的完整 Character 列表。需要先完整读取再筛选发布状态，避免草稿占用
 * 服务端分页位置，导致后续已经发布的资产在前端永远不可见。
 */
export async function loadAllCharactersByProject(
  apis: Pick<CharacterApis, 'listByProject'>,
  projectId: string,
  pageSize = 100,
): Promise<Character[]> {
  const firstPage = await apis.listByProject(projectId, { page: 1, pageSize })
  const characters = [...firstPage.items]
  if (firstPage.pageSize <= 0) return characters

  let page = firstPage.page + 1
  while (characters.length < firstPage.total) {
    const nextPage = await apis.listByProject(projectId, { page, pageSize })
    if (nextPage.items.length === 0) break
    characters.push(...nextPage.items)
    page += 1
  }
  return characters
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
  actions: CharacterActionDto[]
}

interface CharacterDataDto {
  version: number
  outfits: CharacterOutfitDto[]
}

interface CharacterDto {
  id: number
  project_id: number
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
    actions: dto.actions.map((action) => mapAction(action, dto.id)),
  }
}

function mapCharacter(dto: CharacterDto): Character {
  const characterId = String(dto.id)
  return {
    id: characterId,
    projectId: String(dto.project_id),
    name: dto.name,
    description: dto.description,
    referenceImageUrl: dto.reference_image_url,
    dataVersion: dto.character_data.version,
    status: dto.status,
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
      query: {
        project_id: toBackendId(projectId, 'projectId'),
        page: query.page,
        page_size: query.pageSize,
      },
    })
    return { ...result, items: result.items.map(mapCharacter) }
  },

  async create(input) {
    const dto = await getApiClient().request<CharacterDto>('/characters', {
      method: 'POST',
      json: {
        project_id: toBackendId(input.projectId, 'projectId'),
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
