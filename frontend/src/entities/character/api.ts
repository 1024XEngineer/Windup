import type {
  Action,
  ActionType,
  Character,
  CharacterApis,
  CreateCharacterInput,
  Frame,
  Outfit,
} from '.'

import { del, get, getPage, patch, post } from '@/shared/api'
import type { Paged, PageQuery } from '@/shared/pagination'

/* ─── 后端 DTO ─── */

interface BackendFrame {
  index: number
  image_url: string
  duration_ms: number | null
  root_motion?: { dx: number; dy: number } | null
}

interface BackendAction {
  id: string
  type: string
  name: string
  loop: boolean
  fps: number
  frame_count: number
  frames: BackendFrame[]
}

interface BackendOutfit {
  id: string
  name: string
  description: string | null
  preview_url: string | null
  actions: BackendAction[]
}

interface BackendCharacterData {
  version: number
  outfits: BackendOutfit[]
}

interface BackendCharacter {
  id: number
  project_id: number
  name?: string | null
  description: string | null
  reference_image_url: string | null
  character_data: BackendCharacterData
  status: number
  create_at?: string
  update_at?: string
}

/* ─── 映射 ─── */

const ACTION_TYPE_SET = new Set<string>(['walk', 'idle', 'attack', 'jump', 'custom'])

function toActionType(raw: string): ActionType {
  return ACTION_TYPE_SET.has(raw) ? (raw as ActionType) : 'custom'
}

function toFrame(raw: BackendFrame): Frame {
  return {
    imageUrl: raw.image_url,
    durationMs: raw.duration_ms,
    rootMotion: raw.root_motion ?? null,
  }
}

function toAction(raw: BackendAction, outfitId: string): Action {
  return {
    id: raw.id,
    outfitId,
    name: raw.name,
    expectedFrameCount: raw.frame_count,
    loop: raw.loop,
    kind: 'custom', // 后端不区分 preset/custom
    type: toActionType(raw.type),
    fps: raw.fps,
    keyFrameIndex: null, // 后端不提供关键帧索引
    frames: raw.frames.sort((a, b) => a.index - b.index).map(toFrame),
  }
}

function toOutfit(raw: BackendOutfit, characterId: string): Outfit {
  return {
    id: raw.id,
    characterId,
    name: raw.name,
    description: raw.description,
    candidateCharacterTemplates: [], // 后端 character_data 不含候选
    characterTemplateUrl: raw.preview_url,
    baseFrames: [],
    actions: raw.actions.map((a) => toAction(a, raw.id)),
  }
}

function toCharacter(raw: BackendCharacter): Character {
  const id = String(raw.id)
  return {
    id,
    projectId: String(raw.project_id),
    name: raw.name ?? null,
    description: raw.description,
    referenceImageUrl: raw.reference_image_url,
    dataVersion: raw.character_data?.version ?? 1,
    status: raw.status,
    createdAt: raw.create_at ?? '',
    updatedAt: raw.update_at ?? '',
    outfits: (raw.character_data?.outfits ?? []).map((o) => toOutfit(o, id)),
  }
}

/* ─── 适配器 ─── */

export function createCharacterApis(): CharacterApis {
  async function listPageByProject(
    projectId: string,
    query: PageQuery = {},
  ): Promise<Paged<Character>> {
    const params = new URLSearchParams({ project_id: projectId })
    if (query.page) params.set('page', String(query.page))
    if (query.pageSize) params.set('page_size', String(query.pageSize))
    const page = await getPage<BackendCharacter>(`/characters?${params}`)
    return { ...page, items: page.items.map(toCharacter) }
  }

  return {
    async get(id: string): Promise<Character> {
      const raw = await get<BackendCharacter>(`/characters/${id}`)
      return toCharacter(raw)
    },

    async listByProject(projectId: string): Promise<Character[]> {
      const items: Character[] = []
      let pageNumber = 1
      for (;;) {
        const page = await listPageByProject(projectId, { page: pageNumber, pageSize: 100 })
        items.push(...page.items)
        if (items.length >= page.total || page.items.length === 0) break
        pageNumber += 1
      }
      return items
    },

    listPageByProject,

    async create(input: CreateCharacterInput): Promise<Character> {
      const raw = await post<BackendCharacter>('/characters', {
        project_id: Number(input.projectId),
        name: input.name ?? null,
        description: input.description,
        reference_image_url: input.referenceImageUrl ?? null,
      })
      return toCharacter(raw)
    },

    async update(character: Character): Promise<Character> {
      const payload = {
        name: character.name ?? null,
        description: character.description ?? null,
        reference_image_url: character.referenceImageUrl ?? null,
        character_data: {
          version: character.dataVersion ?? 1,
          outfits: character.outfits.map((outfit) => ({
            id: outfit.id,
            name: outfit.name,
            description: outfit.description ?? null,
            preview_url: outfit.characterTemplateUrl,
            actions: outfit.actions.map((action) => ({
              id: action.id,
              type: action.type,
              name: action.name,
              loop: action.loop ?? false,
              fps: action.fps,
              frame_count: action.expectedFrameCount ?? action.frames.length,
              frames: action.frames.map((frame, index) => ({
                index,
                image_url: frame.imageUrl,
                duration_ms: frame.durationMs,
              })),
            })),
          })),
        },
      }
      const raw = await patch<BackendCharacter>(`/characters/${character.id}`, payload)
      const saved = toCharacter(raw)
      if (saved.projectId !== character.projectId) {
        throw new Error('后端未保存新的项目归属')
      }
      return saved
    },

    async remove(id: string): Promise<void> {
      await del(`/characters/${id}`)
    },
  }
}
