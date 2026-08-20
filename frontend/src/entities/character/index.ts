import { createApiClient, getApiAccessToken } from '@/shared/api'
import type { Paged, PageQuery } from '@/shared/pagination'

import { isActionDirection, resolveActionDirection, type ActionDirection } from './directions'

export type { ActionDirection } from './directions'

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

export interface ActionSequence {
  readonly direction: ActionDirection
  readonly sourceDirection: ActionDirection | null
  readonly mirrorX: boolean
  readonly frameCount: number
  readonly frames: Frame[]
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
  /** 可选多方向序列；旧资产的顶层 frames 在单向项目中视为 east。 */
  sequences?: ActionSequence[]
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

interface CharacterActionSequenceDto {
  direction: unknown
  source_direction: unknown
  mirror_x: unknown
  frame_count: number
  frames: CharacterFrameDto[]
}

interface CharacterActionDto {
  id: string
  type: string
  name: string
  loop: boolean
  fps: number
  frame_count: number
  frames: CharacterFrameDto[]
  sequences?: CharacterActionSequenceDto[]
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

function mapActionSequences(dtos: CharacterActionSequenceDto[]): ActionSequence[] {
  const directions = new Set<ActionDirection>()
  const sequences = dtos.map((dto) => {
    if (!isActionDirection(dto.direction) || directions.has(dto.direction)) {
      throw new TypeError('动作方向无效或重复')
    }
    directions.add(dto.direction)
    const resolution = resolveActionDirection(dto.direction)
    const sourceDirection = dto.source_direction
    if (
      typeof dto.mirror_x !== 'boolean' ||
      (sourceDirection !== null && !isActionDirection(sourceDirection)) ||
      dto.mirror_x !== resolution.mirrorX ||
      sourceDirection !== (resolution.mirrorX ? resolution.sourceDirection : null)
    ) {
      throw new TypeError('动作方向镜像关系无效')
    }
    if (dto.mirror_x && dto.frames.length > 0) {
      throw new TypeError('镜像动作方向不能保存独立帧')
    }
    if (
      !dto.mirror_x &&
      (dto.frame_count <= 0 ||
        dto.frames.length !== dto.frame_count ||
        dto.frames
          .map((frame) => frame.index)
          .sort((left, right) => left - right)
          .some((index, expected) => index !== expected))
    ) {
      throw new TypeError('源动作方向帧无效')
    }
    return {
      direction: dto.direction,
      sourceDirection,
      mirrorX: dto.mirror_x,
      frameCount: dto.frame_count,
      frames: dto.frames.map(mapFrame),
    }
  })

  const byDirection = new Map(sequences.map((sequence) => [sequence.direction, sequence]))
  for (const sequence of sequences) {
    if (sequence.sourceDirection === null) continue
    const source = byDirection.get(sequence.sourceDirection)
    if (source === undefined || source.sourceDirection !== null || source.mirrorX) {
      throw new TypeError('镜像动作方向缺少源方向')
    }
    if (sequence.frameCount !== source.frameCount) {
      throw new TypeError('镜像动作方向帧数与源方向不一致')
    }
  }
  return sequences
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
    ...(dto.sequences === undefined
      ? {}
      : {
          sequences: mapActionSequences(dto.sequences),
        }),
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
    ...(action.sequences === undefined
      ? {}
      : {
          sequences: action.sequences.map((sequence) => ({
            direction: sequence.direction,
            source_direction: sequence.sourceDirection,
            mirror_x: sequence.mirrorX,
            frame_count: sequence.frameCount,
            frames: sequence.frames.map(toFrameDto),
          })),
        }),
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
