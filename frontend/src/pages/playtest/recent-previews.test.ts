import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_RECENT_PREVIEWS,
  recentPreviewOwnerIdFromAccessToken,
  readRecentPreviews,
  rememberRecentPreview,
  removeRecentPreview,
  type RecentPreview,
} from './recent-previews'

const preview = (overrides: Partial<RecentPreview> = {}): RecentPreview => ({
  characterId: '51',
  outfitId: 'outfit-default',
  characterName: '轻装信使',
  outfitName: '常态造型',
  projectId: '42',
  projectName: '点灯人 · MVP',
  previewUrl: 'https://cdn.windup.test/messenger-outfit.png',
  lastOpenedAt: 1,
  ...overrides,
})

function createStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  }
}

describe('recent previews', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00Z'))
  })

  it('uses the authenticated JWT subject as the account namespace', () => {
    expect(recentPreviewOwnerIdFromAccessToken('header.eyJzdWIiOiI3In0.signature')).toBe('7')
    expect(recentPreviewOwnerIdFromAccessToken('not-a-jwt')).toBeNull()
  })

  it('keeps recent previews isolated by user and caps them at three unique outfits', () => {
    const storage = createStorage()

    for (let index = 0; index < MAX_RECENT_PREVIEWS + 1; index += 1) {
      rememberRecentPreview(
        'user-7',
        preview({ characterId: String(index), outfitId: `outfit-${index}` }),
        storage,
      )
    }
    rememberRecentPreview('user-7', preview({ characterId: '2', outfitId: 'outfit-2' }), storage)
    rememberRecentPreview('user-8', preview({ characterId: '99', outfitId: 'outfit-99' }), storage)

    expect(readRecentPreviews('user-7', storage).map((item) => item.outfitId)).toEqual([
      'outfit-2',
      'outfit-3',
      'outfit-1',
    ])
    expect(readRecentPreviews('user-8', storage).map((item) => item.outfitId)).toEqual([
      'outfit-99',
    ])
  })

  it('drops an invalid recent record without throwing when storage contains malformed data', () => {
    const storage = createStorage()
    storage.setItem('windup.playtest.recent.v1:user-7', '{"bad":true}')

    expect(readRecentPreviews('user-7', storage)).toEqual([])
  })

  it('removes only the requested character and outfit pair', () => {
    const storage = createStorage()
    rememberRecentPreview('user-7', preview(), storage)
    rememberRecentPreview(
      'user-7',
      preview({ characterId: '52', outfitId: 'outfit-draft', outfitName: '另一套' }),
      storage,
    )

    removeRecentPreview('user-7', '51', 'outfit-default', storage)

    expect(readRecentPreviews('user-7', storage).map((item) => item.outfitId)).toEqual([
      'outfit-draft',
    ])
  })
})
