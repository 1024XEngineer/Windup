import { ApiError, get, post } from '@/shared/api'

import type {
  PlaytestInspection,
  PlaytestInspectionApis,
  PlaytestInspectionTarget,
  SavePlaytestInspectionInput,
} from '.'

interface BackendPlaytestInspection {
  id: number
  character_id: number
  outfit_id: string
  action_id: string
  status: PlaytestInspection['status']
  create_at: string
  update_at: string
}

function toInspection(raw: BackendPlaytestInspection): PlaytestInspection {
  return {
    id: String(raw.id),
    characterId: String(raw.character_id),
    outfitId: raw.outfit_id,
    actionId: raw.action_id,
    status: raw.status,
    createdAt: raw.create_at,
    updatedAt: raw.update_at,
  }
}

function queryFor(target: PlaytestInspectionTarget): string {
  const query = new URLSearchParams({
    character_id: target.characterId,
    outfit_id: target.outfitId,
    action_id: target.actionId,
  })
  return query.toString()
}

export function createPlaytestInspectionApis(): PlaytestInspectionApis {
  return {
    async get(target) {
      try {
        const raw = await get<BackendPlaytestInspection>(
          `/playtest-inspections?${queryFor(target)}`,
        )
        return toInspection(raw)
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 404) return null
        throw cause
      }
    },

    async save(input: SavePlaytestInspectionInput) {
      const raw = await post<BackendPlaytestInspection>('/playtest-inspections', {
        character_id: Number(input.characterId),
        outfit_id: input.outfitId,
        action_id: input.actionId,
        status: input.status,
      })
      return toInspection(raw)
    },
  }
}
