import { createApiClient, getApiAccessToken, type ApiClient } from '@/shared/api'

import type {
  Render3DMotion,
  BakeJob,
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

/** 与出帧台的材质表同一份。多一个少一个都会让下游在渲完之后才抛。 */
const BAKE_MATERIALS = new Set(['cel', 'lit', 'clay', 'toon', 'orig'])

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
    billing: requireString(cost.billing, 'cost.billing'),
    scope: requireString(cost.scope, 'cost.scope'),
  }
}

const KNOWN_MOTIONS: ReadonlySet<string> = new Set(['walk', 'idle', 'jump'])

/** 认不出的动作名跳过,不带进界面 —— 界面上多一个点不动的按钮比少一个更糟。 */
function parseMotions(value: unknown): Render3DMotion[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (m): m is Render3DMotion => typeof m === 'string' && KNOWN_MOTIONS.has(m),
  )
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
    // 后端没给（旧版本）时给空数组，不猜 —— 猜成 ['walk'] 会让界面声称一个
    // 可能并不存在的动作已经烘好，用户点不了也不知道为什么。
    bakedMotions: parseMotions(raw.baked_motions),
    bakeableMotions: parseMotions(raw.bakeable_motions),
    error: nullableString(raw.error, 'error'),
    cost: parseCost(raw.cost),
  }
}

function parseBakeJob(value: unknown): BakeJob {
  const raw = requireRecord(value, '出帧任务')
  const material = requireString(raw.material, 'material')
  // 材质在这里就校验:出帧台对认不出的取值当场抛,而那时候已经把模型下下来了。
  if (!BAKE_MATERIALS.has(material)) {
    throw new Render3DContractError(`material 未知：${material}`)
  }
  return {
    taskId: requireNumber(raw.task_id, 'task_id'),
    modelUrl: requireString(raw.model_url, 'model_url'),
    clip: requireString(raw.clip, 'clip'),
    direction: requireString(raw.direction, 'direction'),
    cameraYaw: requireNumber(raw.camera_yaw, 'camera_yaw'),
    frames: requireNumber(raw.frames, 'frames'),
    width: requireNumber(raw.width, 'width'),
    height: requireNumber(raw.height, 'height'),
    material,
    minCoverage: requireNumber(raw.min_coverage, 'min_coverage'),
    deadlineAt: requireNumber(raw.deadline_at, 'deadline_at'),
    received: requireNumber(raw.received, 'received'),
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

    async buildOutfitAsset(characterId, outfitId, stance) {
      return parseAsset(
        await client.request<unknown>(`${outfitPath(characterId, outfitId)}/build`, {
          method: 'POST',
          json: { stance },
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

    async addOutfitMotion(characterId, outfitId, motion) {
      return parseAsset(
        await client.request<unknown>(`${outfitPath(characterId, outfitId)}/motions`, {
          method: 'POST',
          json: { motion },
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

    async getBakeJob(taskId) {
      try {
        return parseBakeJob(await client.request<unknown>(`/render3d/bake/${taskId}`))
      } catch (error) {
        // 契约不符要炸,"没有登记"是正常结果:任务不走三渲二、或已经收口了。
        if (error instanceof Render3DContractError) throw error
        return null
      }
    },

    async putBakeFrame(taskId, index, png) {
      const form = new FormData()
      // 不手动设置 Content-Type,浏览器会为 FormData 自动附加 boundary。
      form.append('file', png, `f${String(index).padStart(2, '0')}.png`)
      const raw = requireRecord(
        await client.request<unknown>(`/render3d/bake/${taskId}/frames/${index}`, {
          method: 'POST',
          body: form,
        }),
        '交帧结果',
      )
      return requireNumber(raw.received, 'received')
    },

    async completeBake(taskId, completion) {
      await client.request<unknown>(`/render3d/bake/${taskId}/complete`, {
        method: 'POST',
        json: {
          clip: completion.clip,
          sample_times: completion.sampleTimes,
          rig: completion.rig
            ? {
                bones: completion.rig.bones,
                root_bone: completion.rig.rootBone,
                bone_names: completion.rig.boneNames,
                skinned_meshes: completion.rig.skinnedMeshes,
                vertices: completion.rig.vertices,
                available_clips: completion.rig.availableClips,
              }
            : null,
          root_motion: completion.rootMotion ?? null,
        },
      })
    },

    async failBake(taskId, reason) {
      await client.request<unknown>(`/render3d/bake/${taskId}/fail`, {
        method: 'POST',
        json: { reason },
      })
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
  buildOutfitAsset: (characterId, outfitId, stance) =>
    createRender3DApis().buildOutfitAsset(characterId, outfitId, stance),
  approveOutfitAsset: (characterId, outfitId) =>
    createRender3DApis().approveOutfitAsset(characterId, outfitId),
  discardOutfitAsset: (characterId, outfitId) =>
    createRender3DApis().discardOutfitAsset(characterId, outfitId),
  getBakeJob: (taskId) => createRender3DApis().getBakeJob(taskId),
  putBakeFrame: (taskId, index, png) => createRender3DApis().putBakeFrame(taskId, index, png),
  completeBake: (taskId, completion) => createRender3DApis().completeBake(taskId, completion),
  failBake: (taskId, reason) => createRender3DApis().failBake(taskId, reason),
}
