export const MAX_RECENT_PREVIEWS = 3

const STORAGE_PREFIX = 'windup.playtest.recent.v1:'

export interface RecentPreview {
  characterId: string
  outfitId: string
  characterName: string
  outfitName: string
  projectId: string
  projectName: string
  previewUrl: string | null
  lastOpenedAt: number
}

type RecentPreviewStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`
}

function getStorage(storage?: RecentPreviewStorage): RecentPreviewStorage | null {
  if (storage) return storage
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

function isRecentPreview(value: unknown): value is RecentPreview {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<RecentPreview>
  return (
    typeof item.characterId === 'string' &&
    typeof item.outfitId === 'string' &&
    typeof item.characterName === 'string' &&
    typeof item.outfitName === 'string' &&
    typeof item.projectId === 'string' &&
    typeof item.projectName === 'string' &&
    (typeof item.previewUrl === 'string' || item.previewUrl === null) &&
    typeof item.lastOpenedAt === 'number'
  )
}

export function readRecentPreviews(
  userId: string,
  storage?: RecentPreviewStorage,
): RecentPreview[] {
  const target = getStorage(storage)
  if (!target) return []

  try {
    const raw = target.getItem(storageKey(userId))
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter(isRecentPreview).slice(0, MAX_RECENT_PREVIEWS)
  } catch {
    return []
  }
}

export function rememberRecentPreview(
  userId: string,
  preview: RecentPreview,
  storage?: RecentPreviewStorage,
): RecentPreview[] {
  const target = getStorage(storage)
  if (!target) return [preview]

  const current = readRecentPreviews(userId, target)
  const next = [
    { ...preview, lastOpenedAt: Date.now() },
    ...current.filter(
      (item) => !(item.characterId === preview.characterId && item.outfitId === preview.outfitId),
    ),
  ].slice(0, MAX_RECENT_PREVIEWS)

  try {
    target.setItem(storageKey(userId), JSON.stringify(next))
  } catch {
    // localStorage is an enhancement; the current workbench remains usable if it is blocked.
  }
  return next
}

export function removeRecentPreview(
  userId: string,
  characterId: string,
  outfitId: string,
  storage?: RecentPreviewStorage,
): RecentPreview[] {
  const target = getStorage(storage)
  if (!target) return []

  const next = readRecentPreviews(userId, target).filter(
    (item) => !(item.characterId === characterId && item.outfitId === outfitId),
  )
  try {
    if (next.length === 0) target.removeItem(storageKey(userId))
    else target.setItem(storageKey(userId), JSON.stringify(next))
  } catch {
    // A stale shortcut must never block entering the real preview workbench.
  }
  return next
}
