import { createApiClient, getApiAccessToken, type ApiClient } from '@/shared/api'

import type {
  MasterFacts,
  MasterPrecheckReport,
  MasterRejectCode,
  MasterWarning,
  MasterWarningCode,
  Render3DApis,
  Render3DAsset,
  Render3DAssetCost,
  Render3DAssetState,
} from '.'

/** 后端声称成功、但返回数据不符合 /render3d 契约。 */
export class Render3DContractError extends Error {
  constructor(message: string) {
    super(`三渲二资产响应格式错误：${message}`)
    this.name = 'Render3DContractError'
  }
}

const REJECT_CODES = new Set<MasterRejectCode>([
  'undecodable',
  'no_subject',
  'subject_too_small',
  'aspect_too_wide',
])

const WARNING_CODES = new Set<MasterWarningCode>(['limbs_fused', 'extra_component'])

const ASSET_STATES = new Set<Render3DAssetState>([
  'absent',
  'building',
  'awaiting_review',
  'rigging',
  'ready',
  'failed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Render3DContractError(`${field} 不是对象`)
  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Render3DContractError(`${field} 不是有限数字`)
  }
  return value
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Render3DContractError(`${field} 不是字符串`)
  return value
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  return requireString(value, field)
}

function requireIntegers(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new Render3DContractError(`${field} 不是数组`)
  return value.map((item, index) => requireNumber(item, `${field}[${index}]`))
}

function parseFacts(value: unknown): MasterFacts | null {
  if (value === null || value === undefined) return null
  const facts = requireRecord(value, 'facts')
  return {
    width: requireNumber(facts.width, 'facts.width'),
    height: requireNumber(facts.height, 'facts.height'),
    subjectRatio: requireNumber(facts.subject_ratio, 'facts.subject_ratio'),
    subjectAreaRatio: requireNumber(facts.subject_area_ratio, 'facts.subject_area_ratio'),
    limbSegments: requireIntegers(facts.limb_segments, 'facts.limb_segments'),
    components: requireIntegers(facts.components, 'facts.components'),
  }
}

function parseWarnings(value: unknown): MasterWarning[] {
  if (!Array.isArray(value)) throw new Render3DContractError('warnings 不是数组')
  return value.map((item, index) => {
    const warning = requireRecord(item, `warnings[${index}]`)
    const code = requireString(warning.code, `warnings[${index}].code`)
    if (!WARNING_CODES.has(code as MasterWarningCode)) {
      throw new Render3DContractError(`warnings[${index}].code 未知：${code}`)
    }
    return {
      code: code as MasterWarningCode,
      detail: requireString(warning.detail, `warnings[${index}].detail`),
    }
  })
}

function parseReport(value: unknown): MasterPrecheckReport {
  const raw = requireRecord(value, '预检结果')
  if (typeof raw.accepted !== 'boolean') {
    throw new Render3DContractError('accepted 不是布尔值')
  }
  const rejectCode = nullableString(raw.reject_code, 'reject_code')
  if (rejectCode !== null && !REJECT_CODES.has(rejectCode as MasterRejectCode)) {
    throw new Render3DContractError(`reject_code 未知：${rejectCode}`)
  }
  // 通过却带着拒绝码、或被拒却没有拒绝码，都说明后端两处判定分叉了。放行的话
  // 界面会显示"这张可用"而下游拒收，用户只会看到一个无从解释的失败。
  if (raw.accepted === (rejectCode !== null)) {
    throw new Render3DContractError('accepted 与 reject_code 自相矛盾')
  }
  return {
    accepted: raw.accepted,
    rejectCode: rejectCode as MasterRejectCode | null,
    detail: requireString(raw.detail, 'detail'),
    facts: parseFacts(raw.facts),
    warnings: parseWarnings(raw.warnings),
  }
}

function parseCost(value: unknown): Render3DAssetCost {
  const cost = requireRecord(value, 'cost')
  return {
    model3dCredits: requireNumber(cost.model3d_credits, 'cost.model3d_credits'),
    autorigCredits: requireNumber(cost.autorig_credits, 'cost.autorig_credits'),
    totalCredits: requireNumber(cost.total_credits, 'cost.total_credits'),
    totalCny: requireNumber(cost.total_cny, 'cost.total_cny'),
    billing: requireString(cost.billing, 'cost.billing'),
    scope: requireString(cost.scope, 'cost.scope'),
  }
}

function parseAsset(value: unknown): Render3DAsset {
  const raw = requireRecord(value, '3D 资产状态')
  const state = requireString(raw.state, 'state')
  if (!ASSET_STATES.has(state as Render3DAssetState)) {
    throw new Render3DContractError(`state 未知：${state}`)
  }
  return {
    state: state as Render3DAssetState,
    model3dUrl: nullableString(raw.model_3d_url, 'model_3d_url'),
    reviewModelUrl: nullableString(raw.review_model_url, 'review_model_url'),
    error: nullableString(raw.error, 'error'),
    cost: parseCost(raw.cost),
  }
}

function outfitPath(characterId: string, outfitId: string): string {
  return `/render3d/characters/${encodeURIComponent(characterId)}/outfits/${encodeURIComponent(outfitId)}`
}

/**
 * 创建三渲二资产适配器。
 *
 * 每个字段都在网络边界校验：状态与成本决定的是**要不要花 30 积分**，把没校验过的
 * 数据带进界面，等于让用户按一个来路不明的数字做付费决定。
 */
export function createRender3DApis(client: ApiClient = defaultClient()): Render3DApis {
  return {
    async precheckMaster(imageUrl, canvas) {
      return parseReport(
        await client.request<unknown>('/render3d/master-precheck', {
          method: 'POST',
          json: {
            image_url: imageUrl,
            canvas_width: canvas?.width ?? null,
            canvas_height: canvas?.height ?? null,
          },
        }),
      )
    },

    async getOutfitAsset(characterId, outfitId) {
      return parseAsset(await client.request<unknown>(outfitPath(characterId, outfitId)))
    },

    async buildOutfitAsset(characterId, outfitId) {
      return parseAsset(
        await client.request<unknown>(`${outfitPath(characterId, outfitId)}/build`, {
          method: 'POST',
        }),
      )
    },

    async approveOutfitAsset(characterId, outfitId) {
      return parseAsset(
        await client.request<unknown>(`${outfitPath(characterId, outfitId)}/approve`, {
          method: 'POST',
        }),
      )
    },

    async discardOutfitAsset(characterId, outfitId) {
      return parseAsset(
        await client.request<unknown>(`${outfitPath(characterId, outfitId)}/discard`, {
          method: 'POST',
        }),
      )
    },
  }
}

function defaultClient(): ApiClient {
  return createApiClient({ getAccessToken: getApiAccessToken })
}

export const render3DApis: Render3DApis = {
  precheckMaster: (imageUrl, canvas) => createRender3DApis().precheckMaster(imageUrl, canvas),
  getOutfitAsset: (characterId, outfitId) =>
    createRender3DApis().getOutfitAsset(characterId, outfitId),
  buildOutfitAsset: (characterId, outfitId) =>
    createRender3DApis().buildOutfitAsset(characterId, outfitId),
  approveOutfitAsset: (characterId, outfitId) =>
    createRender3DApis().approveOutfitAsset(characterId, outfitId),
  discardOutfitAsset: (characterId, outfitId) =>
    createRender3DApis().discardOutfitAsset(characterId, outfitId),
}
