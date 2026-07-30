import type {
  Action,
  ActionType,
  Character,
  CharacterApis,
  CreateCharacterInput,
  Frame,
  Outfit,
} from '@/entities'

import { del, get, patch, post } from './http-client'

/* ─── 后端 DTO ─── */

interface BackendFrame {
  index: number
  image_url: string
  duration_ms: number | null
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
  description: string | null
  reference_image_url: string | null
  character_data: BackendCharacterData
  status: number
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
    rootMotion: null, // 后端不提供根位移
  }
}

function toAction(raw: BackendAction, outfitId: string): Action {
  return {
    id: raw.id,
    outfitId,
    name: raw.name,
    kind: 'custom', // 后端不区分 preset/custom
    type: toActionType(raw.type),
    fps: raw.fps,
    keyFrameIndex: null, // 后端不提供关键帧索引
    frames: raw.frames
      .sort((a, b) => a.index - b.index)
      .map(toFrame),
  }
}

function toOutfit(raw: BackendOutfit, characterId: string): Outfit {
  return {
    id: raw.id,
    characterId,
    name: raw.name,
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
    createdAt: '', // 后端列表不返回时间戳
    updatedAt: '',
    outfits: (raw.character_data?.outfits ?? []).map((o) => toOutfit(o, id)),
  }
}

/* ─── 适配器 ─── */

interface BackendListResponse {
  data: BackendCharacter[]
  total: number
  page: number
  page_size: number
}

export function createCharacterApis(): CharacterApis {
  return {
    async get(id: string): Promise<Character> {
      const raw = await get<BackendCharacter>(`/characters/${id}`)
      return toCharacter(raw)
    },

    async listByProject(projectId: string): Promise<Character[]> {
      const raw = await get<BackendListResponse>(
        `/characters?project_id=${encodeURIComponent(projectId)}`,
      )
      return raw.data.map(toCharacter)
    },

    async create(input: CreateCharacterInput): Promise<Character> {
      const raw = await post<BackendCharacter>('/characters', {
        project_id: Number(input.projectId),
        description: input.description,
        reference_image_url: input.referenceImageUrl ?? null,
      })
      return toCharacter(raw)
    },

    async update(character: Character): Promise<Character> {
      const payload = {
        character_data: {
          version: 1,
          outfits: character.outfits.map((outfit) => ({
            id: outfit.id,
            name: outfit.name,
            description: null,
            preview_url: outfit.characterTemplateUrl,
            actions: outfit.actions.map((action) => ({
              id: action.id,
              type: action.type,
              name: action.name,
              loop: false,
              fps: action.fps,
              frame_count: action.frames.length,
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
      return toCharacter(raw)
    },
  }
}
