import {
  ACTION_DIRECTIONS,
  getDirectionProfile,
  resolveActionDirection,
  type ActionDirection,
  type DirectionalMovement,
} from '@/entities'

import type { QuickStartCandidate, QuickStartDirectionSelections } from './service'

export interface DirectionSheetCell {
  direction: ActionDirection
  imageUrl: string | null
  sourceDirection: ActionDirection
  mirrorX: boolean
  empty: boolean
}

export interface DirectionSheetCandidate {
  index: number
  selections: QuickStartDirectionSelections
  cells: Readonly<Record<ActionDirection, DirectionSheetCell>>
}

function sourceCandidatesByDirection(candidates: readonly QuickStartCandidate[]) {
  const byDirection = new Map<ActionDirection, Map<number, string>>()
  for (const candidate of candidates) {
    const byIndex = byDirection.get(candidate.direction) ?? new Map<number, string>()
    if (!byIndex.has(candidate.index)) byIndex.set(candidate.index, candidate.imageUrl)
    byDirection.set(candidate.direction, byIndex)
  }
  return byDirection
}

function completeCandidateIndices(
  sourceDirections: readonly ActionDirection[],
  byDirection: ReadonlyMap<ActionDirection, ReadonlyMap<number, string>>,
): number[] {
  const firstDirection = sourceDirections[0]
  if (!firstDirection) return []
  const indices = [...(byDirection.get(firstDirection)?.keys() ?? [])]
  return indices
    .filter((index) =>
      sourceDirections.every((direction) => byDirection.get(direction)?.has(index)),
    )
    .sort((left, right) => left - right)
}

export function buildDirectionSheetCandidates(
  candidates: readonly QuickStartCandidate[],
  movement: DirectionalMovement,
): readonly DirectionSheetCandidate[] {
  const profile = getDirectionProfile(movement)
  const byDirection = sourceCandidatesByDirection(candidates)
  return completeCandidateIndices(profile.sourceDirections, byDirection).map((index) => {
    const selections = Object.fromEntries(
      profile.sourceDirections.map((direction) => [
        direction,
        byDirection.get(direction)!.get(index)!,
      ]),
    ) as QuickStartDirectionSelections
    const cells = Object.fromEntries(
      ACTION_DIRECTIONS.map((direction) => {
        const isLogicalDirection = profile.logicalDirections.includes(direction)
        const resolved = resolveActionDirection(direction)
        const imageUrl = isLogicalDirection ? (selections[resolved.sourceDirection] ?? null) : null
        return [
          direction,
          {
            direction,
            imageUrl,
            sourceDirection: resolved.sourceDirection,
            mirrorX: imageUrl !== null && resolved.mirrorX,
            empty: imageUrl === null,
          } satisfies DirectionSheetCell,
        ]
      }),
    ) as Record<ActionDirection, DirectionSheetCell>
    return { index, selections, cells }
  })
}
