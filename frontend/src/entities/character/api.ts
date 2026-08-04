import type { Action, ActionType, Character, CharacterApis, Frame, Outfit } from '.'

import { del, get, getPage, patch } from '@/shared/api'

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
    rootMotion: raw.root_motion ?? null,
  }
}

function toAction(raw: BackendAction, outfitId: string): Action {
  return {
    id: raw.id,
    outfitId,
    name: raw.name,
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

export function createCharacterApis(): Pick<
  CharacterApis,
  'get' | 'listByProject' | 'update' | 'remove'
> {
  return {
    async get(id: string): Promise<Character> {
      const raw = await get<BackendCharacter>(`/characters/${id}`)
      return toCharacter(raw)
    },

    async listByProject(projectId: string): Promise<Character[]> {
      const encodedProjectId = encodeURIComponent(projectId)
      const pageSize = 100
      const firstPage = await getPage<BackendCharacter>(
        `/characters?project_id=${encodedProjectId}&page=1&page_size=${pageSize}`,
      )

      // page_size=0 是后端 ListResponse 的“已返回全量”标记，不需要继续翻页。
      // 分页响应则按 total 继续读取，保证 Playtest 的角色切换器不会只显示前 100 个。
      const all = [...firstPage.items]
      if (firstPage.pageSize === 0) return all.map(toCharacter)

      let currentPage = firstPage.page
      while (all.length < firstPage.total) {
        currentPage += 1
        const nextPage = await getPage<BackendCharacter>(
          `/characters?project_id=${encodedProjectId}&page=${currentPage}&page_size=${pageSize}`,
        )
        if (nextPage.page !== currentPage) {
          throw new Error(`角色分页响应页码不一致：请求 ${currentPage}，返回 ${nextPage.page}`)
        }
        if (nextPage.items.length === 0) {
          throw new Error(`角色分页在读取完 total 前返回空页：${all.length}/${firstPage.total}`)
        }
        all.push(...nextPage.items)
        if (nextPage.pageSize === 0) break
      }
      return all.map(toCharacter)
    },

    async update(character: Character): Promise<Character> {
      const payload = {
        project_id: Number(character.projectId),
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
              loop: action.loop ?? false,
              fps: action.fps,
              frame_count: action.frames.length,
              frames: action.frames.map((frame, index) => ({
                index,
                image_url: frame.imageUrl,
                duration_ms: frame.durationMs,
                root_motion: frame.rootMotion,
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
