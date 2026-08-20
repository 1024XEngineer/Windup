// 解析与校验 Windup → Cocos Creator 适配包里的 cocos-import.json。
// 暴露纯函数,无副作用,便于 Node CLI 与 Cocos 扩展共享。

import { IMPORT_LIMITS } from './limits.js'

/**
 * @typedef {{
 *   schema_version: string,
 *   experimental: true,
 *   engine: 'cocos-creator',
 *   upstream_issue: number,
 *   package: { character_id: string, character_name: string, outfit_id: string, outfit_name: string, canvas: {w:number, h:number} },
 *   master: { file: string, anchor: {x:number, y:number}, anchor_cocos: {x:number, y:number} },
 *   actions: Array<{
 *     id: string, name: string, export_name: string, direction: string,
 *     fps: number, timing_mode?: 'constant-fps'|'per-frame', loop: boolean, quality_status: 'passed'|'pending'|'failed',
 *     anchor: {x:number, y:number}, anchor_cocos: {x:number, y:number},
 *     foot_y: number, frames: Array<{index:number, file:string, duration_ms: number|null}>,
 *     atlas: { file: string, cols: number, rows: number, cell: {w:number, h:number} }
 *   }>
 * }} WindupCocosManifest
 */

const REQUIRED_TOP_KEYS = [
  'schema_version',
  'experimental',
  'engine',
  'upstream_issue',
  'package',
  'master',
  'actions',
]

const REQUIRED_PACKAGE_KEYS = [
  'character_id',
  'character_name',
  'outfit_id',
  'outfit_name',
  'canvas',
]

const REQUIRED_MASTER_KEYS = ['file', 'anchor', 'anchor_cocos']

const REQUIRED_ACTION_KEYS = [
  'id',
  'name',
  'export_name',
  'direction',
  'fps',
  'loop',
  'quality_status',
  'anchor',
  'anchor_cocos',
  'foot_y',
  'frames',
  'atlas',
]

const VALID_QUALITY = new Set(['passed', 'pending', 'failed'])
const VALID_SCHEMA_VERSIONS = new Set([
  'windup-cocos-import-1.0.0',
  'windup-cocos-import-1.1.0',
])
const VALID_TIMING_MODES = new Set(['constant-fps', 'per-frame'])
const VALID_DIRECTIONS = new Set([
  'default',
  'east', 'west', 'north', 'south',
  'north_east', 'north_west', 'south_east', 'south_west',
])

function record(value, field) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} 必须是对象`)
  }
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * @param {string} jsonText
 * @returns {WindupCocosManifest}
 */
export function parseManifest(jsonText) {
  let data
  try {
    data = JSON.parse(jsonText)
  } catch (err) {
    throw new Error(`cocos-import.json 不是合法 JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  return validateManifest(data)
}

/**
 * @param {unknown} data
 * @returns {WindupCocosManifest}
 */
export function validateManifest(data) {
  if (typeof data !== 'object' || data === null) {
    throw new Error('cocos-import.json 顶层必须是对象')
  }
  const obj = /** @type {Record<string, unknown>} */ (data)

  for (const key of REQUIRED_TOP_KEYS) {
    if (!(key in obj)) throw new Error(`cocos-import.json 缺少字段: ${key}`)
  }

  if (obj.engine !== 'cocos-creator') {
    throw new Error(`engine 必须是 'cocos-creator',实际是 ${JSON.stringify(obj.engine)}`)
  }
  if (obj.experimental !== true) {
    throw new Error(`experimental 必须为 true,实际是 ${JSON.stringify(obj.experimental)}`)
  }
  if (!VALID_SCHEMA_VERSIONS.has(/** @type {string} */ (obj.schema_version))) {
    throw new Error(`schema_version 不受支持: ${obj.schema_version}`)
  }
  if (!Number.isInteger(obj.upstream_issue) || obj.upstream_issue < 1) {
    throw new Error(`upstream_issue 必须为正整数: ${obj.upstream_issue}`)
  }

  // package
  const pkg = record(obj.package, 'cocos-import.json.package')
  for (const key of REQUIRED_PACKAGE_KEYS) {
    if (!(key in pkg)) throw new Error(`cocos-import.json.package 缺少字段: ${key}`)
  }
  for (const key of ['character_id', 'character_name', 'outfit_id', 'outfit_name']) {
    nonEmptyString(pkg[key], `package.${key}`)
  }
  const canvas = record(pkg.canvas, 'cocos-import.json.package.canvas')
  if (!Number.isInteger(canvas.w) || canvas.w < 1) throw new Error('package.canvas.w 必须为正整数')
  if (!Number.isInteger(canvas.h) || canvas.h < 1) throw new Error('package.canvas.h 必须为正整数')

  // master
  const master = record(obj.master, 'cocos-import.json.master')
  for (const key of REQUIRED_MASTER_KEYS) {
    if (!(key in master)) throw new Error(`cocos-import.json.master 缺少字段: ${key}`)
  }
  assetPath(master.file, 'master.file')
  anchor(master.anchor, 'master.anchor')
  anchor(master.anchor_cocos, 'master.anchor_cocos')

  // actions
  if (!Array.isArray(obj.actions)) {
    throw new Error('cocos-import.json.actions 必须是数组')
  }
  const actions = /** @type {Array<Record<string, unknown>>} */ (obj.actions)
  if (actions.length > IMPORT_LIMITS.actions) {
    throw new Error(`actions 动作数超过限制 ${IMPORT_LIMITS.actions}`)
  }
  let totalFrames = 0
  for (let i = 0; i < actions.length; i += 1) {
    totalFrames += validateAction(actions[i], i)
    if (totalFrames > IMPORT_LIMITS.totalFrames) {
      throw new Error(`actions 总帧数超过限制 ${IMPORT_LIMITS.totalFrames}`)
    }
  }

  return /** @type {WindupCocosManifest} */ (data)
}

/**
 * 把旧版 Windup action-assets 包里的 meta.json 转成当前 Cocos 适配清单。
 * 旧包没有 targets/cocos-creator/cocos-import.json,但它仍包含导入器所需
 * 的角色、画布、动作、帧和图集信息;帧时长按旧包的 fps 补齐。
 *
 * @param {Record<string, unknown>} legacy
 * @returns {WindupCocosManifest}
 */
export function buildManifestFromLegacyMeta(legacy) {
  const character = record(legacy.character, 'meta.json.character')
  const outfit = record(legacy.outfit, 'meta.json.outfit')
  const canvas = record(legacy.canvas, 'meta.json.canvas')
  const actions = Array.isArray(legacy.actions) ? legacy.actions : []
  const fallbackAnchor = { x: 0.5, y: 0.92 }
  const masterAnchor = firstAnchor(actions) || fallbackAnchor
  const manifest = {
    schema_version: 'windup-cocos-import-1.1.0',
    experimental: true,
    engine: 'cocos-creator',
    upstream_issue: 94,
    package: {
      character_id: String(character.id ?? ''),
      character_name: String(character.name ?? ''),
      outfit_id: String(outfit.id ?? ''),
      outfit_name: String(outfit.name ?? ''),
      canvas: { w: canvas.w, h: canvas.h },
    },
    master: {
      file: typeof character.image === 'string' ? character.image : 'character/master.png',
      anchor: masterAnchor,
      anchor_cocos: { x: masterAnchor.x, y: 1 - masterAnchor.y },
    },
    actions: actions.map((rawAction, index) => {
      const action = record(rawAction, `meta.json.actions[${index}]`)
      const anchor = anchorOrFallback(action.anchor, masterAnchor)
      const fps = Number(action.fps)
      const frameList = Array.isArray(action.frames) ? action.frames : []
      const atlas = record(action.atlas, `meta.json.actions[${index}].atlas`)
      return {
        id: String(action.id ?? `legacy-action-${index}`),
        name: String(action.name ?? `action-${index}`),
        export_name: String(action.name ?? `action-${index}`),
        direction: validDirection(action.direction) ? action.direction : 'default',
        fps,
        timing_mode: 'constant-fps',
        loop: action.loop !== false,
        quality_status: action.quality_status === 'failed' || action.quality_status === 'pending'
          ? action.quality_status
          : 'passed',
        anchor,
        anchor_cocos: { x: anchor.x, y: 1 - anchor.y },
        foot_y: Number.isFinite(action.foot_y) ? action.foot_y : 0,
        frames: frameList.map((rawFrame, frameIndex) => {
          const frame = record(rawFrame, `meta.json.actions[${index}].frames[${frameIndex}]`)
          return {
            index: frame.index ?? frameIndex,
            file: String(frame.file ?? ''),
            duration_ms: null,
          }
        }),
        atlas,
      }
    }),
  }
  return validateManifest(manifest)
}

function firstAnchor(actions) {
  for (const rawAction of actions) {
    if (rawAction && typeof rawAction === 'object' && !Array.isArray(rawAction)) {
      const anchor = anchorOrFallback(rawAction.anchor, null)
      if (anchor) return anchor
    }
  }
  return null
}

function anchorOrFallback(value, fallback) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    value.x >= 0 &&
    value.x <= 1 &&
    value.y >= 0 &&
    value.y <= 1
  ) {
    return { x: value.x, y: value.y }
  }
  return fallback
}

function validDirection(value) {
  return typeof value === 'string' && VALID_DIRECTIONS.has(value)
}

function validateAction(action, index) {
  action = record(action, `actions[${index}]`)
  for (const key of REQUIRED_ACTION_KEYS) {
    if (!(key in action)) throw new Error(`actions[${index}] 缺少字段: ${key}`)
  }
  for (const key of ['id', 'name', 'export_name']) {
    nonEmptyString(action[key], `actions[${index}].${key}`)
  }
  if (!VALID_QUALITY.has(/** @type {string} */ (action.quality_status))) {
    throw new Error(`actions[${index}].quality_status 非法: ${action.quality_status}`)
  }
  if (!VALID_DIRECTIONS.has(/** @type {string} */ (action.direction))) {
    throw new Error(`actions[${index}].direction 非法: ${action.direction}`)
  }
  if (!Number.isFinite(/** @type {number} */ (action.fps)) || /** @type {number} */ (action.fps) <= 0) {
    throw new Error(`actions[${index}].fps 必须为正数`)
  }
  if (
    action.timing_mode !== undefined &&
    !VALID_TIMING_MODES.has(/** @type {string} */ (action.timing_mode))
  ) {
    throw new Error(`actions[${index}].timing_mode 非法: ${action.timing_mode}`)
  }
  if (typeof action.loop !== 'boolean') {
    throw new Error(`actions[${index}].loop 必须是布尔值`)
  }
  anchor(action.anchor, `actions[${index}].anchor`)
  anchor(action.anchor_cocos, `actions[${index}].anchor_cocos`)
  if (!Number.isFinite(/** @type {number} */ (action.foot_y)) || /** @type {number} */ (action.foot_y) < 0) {
    throw new Error(`actions[${index}].foot_y 必须是非负数`)
  }
  const frames = action.frames
  if (!Array.isArray(frames)) throw new Error(`actions[${index}].frames 必须是数组`)
  if (frames.length === 0) {
    throw new Error(`actions[${index}].frames 不能为空`)
  }
  if (frames.length > IMPORT_LIMITS.framesPerAction) {
    throw new Error(`actions[${index}] 单动作帧数超过限制 ${IMPORT_LIMITS.framesPerAction}`)
  }
  const atlas = record(action.atlas, `actions[${index}].atlas`)
  assetPath(atlas.file, `actions[${index}].atlas.file`)
  if (!Number.isInteger(/** @type {number} */ (atlas.cols)) || /** @type {number} */ (atlas.cols) < 1) {
    throw new Error(`actions[${index}].atlas.cols 必须为正整数`)
  }
  if (!Number.isInteger(/** @type {number} */ (atlas.rows)) || /** @type {number} */ (atlas.rows) < 1) {
    throw new Error(`actions[${index}].atlas.rows 必须为正整数`)
  }
  const cell = record(atlas.cell, `actions[${index}].atlas.cell`)
  if (!Number.isInteger(cell.w) || cell.w < 1) {
    throw new Error(`actions[${index}].atlas.cell.w 必须为正整数`)
  }
  if (!Number.isInteger(cell.h) || cell.h < 1) {
    throw new Error(`actions[${index}].atlas.cell.h 必须为正整数`)
  }
  if (frames.length > atlas.cols * atlas.rows) {
    throw new Error(`actions[${index}].frames 超出图集容量`)
  }
  for (let j = 0; j < frames.length; j += 1) {
    const f = record(frames[j], `actions[${index}].frames[${j}]`)
    if (!Number.isInteger(f.index) || f.index !== j) {
      throw new Error(`actions[${index}].frames[${j}].index 必须从 0 连续递增`)
    }
    assetPath(f.file, `actions[${index}].frames[${j}].file`)
    if (f.duration_ms !== null && (!Number.isFinite(f.duration_ms) || f.duration_ms < 0)) {
      throw new Error(`actions[${index}].frames[${j}].duration_ms 必须是非负数或 null`)
    }
  }
  return frames.length
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 必须是非空字符串`)
  }
}

function assetPath(value, field) {
  nonEmptyString(value, field)
  if (
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.split('/').some((segment) => segment === '' || segment === '..' || segment === '.')
  ) {
    throw new Error(`${field} 必须是安全的相对路径`)
  }
}

function anchor(value, field) {
  const point = record(value, field)
  for (const axis of ['x', 'y']) {
    if (!Number.isFinite(point[axis]) || point[axis] < 0 || point[axis] > 1) {
      throw new Error(`${field}.${axis} 必须在 0 到 1 之间`)
    }
  }
}
