import type { DirectionalMovement } from '../project'

import type { Action, CharacterTemplate } from '.'
import { getDirectionProfile, type ActionDirection } from './directions'

export interface DirectionalAssetValidation {
  readonly complete: boolean
  readonly problems: readonly string[]
}

function realDirections(
  items: readonly {
    direction: ActionDirection
    sourceDirection: ActionDirection | null
    mirrorX: boolean
  }[],
): Set<ActionDirection> {
  return new Set(
    items.flatMap((item) =>
      item.sourceDirection === null && !item.mirrorX ? [item.direction] : [],
    ),
  )
}

function missingDirections(
  required: readonly ActionDirection[],
  actual: ReadonlySet<ActionDirection>,
): ActionDirection[] {
  return required.filter((direction) => !actual.has(direction))
}

export function validateDirectionalAsset(
  version: number,
  movement: DirectionalMovement,
  templates: readonly CharacterTemplate[],
  actions: readonly Action[],
): DirectionalAssetValidation {
  if (version < 2 && movement !== 'single') {
    return { complete: false, problems: ['旧版镜像资产不能作为完整的多方向资产发布'] }
  }

  const profile = getDirectionProfile(movement)
  const required = profile.generationDirections
  const allowed = new Set(profile.logicalDirections)
  const problems: string[] = []
  const missingTemplates = missingDirections(required, realDirections(templates))
  if (missingTemplates.length > 0) {
    problems.push(`角色母版缺少真实方向：${missingTemplates.join('、')}`)
  }
  const unexpectedTemplates = templates
    .map((template) => template.direction)
    .filter((direction) => !allowed.has(direction))
  if (unexpectedTemplates.length > 0) {
    problems.push(`角色母版包含规格外方向：${unexpectedTemplates.join('、')}`)
  }

  for (const action of actions) {
    const missing = missingDirections(required, realDirections(action.sequences ?? []))
    if (missing.length > 0) {
      problems.push(`动作 ${action.id} 缺少真实方向：${missing.join('、')}`)
    }
    const unexpected = (action.sequences ?? [])
      .map((sequence) => sequence.direction)
      .filter((direction) => !allowed.has(direction))
    if (unexpected.length > 0) {
      problems.push(`动作 ${action.id} 包含规格外方向：${unexpected.join('、')}`)
    }
  }

  if (movement === 'single') {
    const invalidDirection = [
      ...templates,
      ...actions.flatMap((action) => action.sequences ?? []),
    ].find((item) => {
      if (item.sourceDirection === null && !item.mirrorX) return item.direction !== 'east'
      return !(item.direction === 'west' && item.sourceDirection === 'east' && item.mirrorX)
    })
    if (invalidDirection) {
      problems.push(`单向资产包含无效方向：${invalidDirection.direction}`)
    }
  }

  return { complete: problems.length === 0, problems }
}
