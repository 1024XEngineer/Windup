// 把"计划 + 字节内容"翻译成 Cocos Creator 真正能识别的 .meta / .prefab / .anim 文件。
// 关键:每个资产分配稳定的 RFC 4122 UUID,Cocos 打开时会保留 .meta 里的 uuid
// 并让 prefab/anim 里的 __uuid__ 引用对得上。Cocos Creator 3.x 会把非 RFC
// 格式的短 ID 重写成新的 UUID,导致导出的引用在编辑器里变成未解析占位符。

/**
 * @typedef {import('./asset-planner.js').ImportPlan} ImportPlan
 */

import { createHash } from 'node:crypto'

/**
 * 路径 → RFC 4122 UUID v5(确定性,跨机器一致)。
 * @param {string} path
 * @returns {string}
 */
export function uuidForPath(path) {
  const hex = createHash('sha1').update(`windup-cocos-importer:${path}`).digest('hex').slice(0, 32).split('')
  // Mark the deterministic SHA-1-derived value as UUID v5 and set the RFC
  // 4122 variant. Creator accepts and preserves this canonical form.
  hex[12] = '5'
  hex[16] = (Number.parseInt(hex[16], 16) & 0x3 | 0x8).toString(16)
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

/**
 * @param {WindupCocosManifest} manifest
 * @param {ImportPlan} plan
 * @param {string} packName
 * @returns {Record<string, string>} filename → JSON 文本
 */
export function buildCocosMetaFiles(manifest, plan, packName) {
  const files = {}

  // 给每个 PNG 分配纹理 UUID 和 SpriteFrame 子资源 UUID。
  // Cocos Creator 的 AnimationClip / Prefab 引用的是子资源 UUID,不是
  // PNG 顶层纹理 UUID;两者都写进 .meta 才能保持 Creator 的引用语义。
  const spriteFrameUuids = new Map()
  for (const sf of plan.spriteFrames) {
    const textureUuid = uuidForPath(sf.cocosPath)
    // Cocos Creator 3.x reserves these sub-asset ids for image imports.  A
    // random/short child UUID is accepted by the CLI but is not materialized
    // into library metadata, leaving Sprite/Animation references unresolved.
    const textureSubUuid = `${textureUuid}@6c48a`
    const spriteFrameUuid = `${textureUuid}@f9941`
    const displayName = sf.cocosPath.split('/').pop()?.replace(/\.png$/i, '') || 'sprite'
    const rawWidth = sf.rect.w
    const rawHeight = sf.rect.h
    const trim = sf.trim || sf.rect
    const trimX = trim.x ?? 0
    const trimY = trim.y ?? 0
    const trimWidth = trim.w ?? rawWidth
    const trimHeight = trim.h ?? rawHeight
    const halfWidth = trimWidth / 2
    const halfHeight = trimHeight / 2
    spriteFrameUuids.set(sf.cocosPath, spriteFrameUuid)
    const metaPath = `${sf.cocosPath}.meta`
    files[metaPath] = JSON.stringify(
      {
        ver: '1.0.27',
        importer: 'image',
        imported: true,
        uuid: textureUuid,
        files: ['.json', '.png'],
        subMetas: {
          '6c48a': {
            importer: 'texture',
            uuid: textureSubUuid,
            displayName,
            id: '6c48a',
            name: 'texture',
            userData: {
              wrapModeS: 'clamp-to-edge',
              wrapModeT: 'clamp-to-edge',
              imageUuidOrDatabaseUri: textureUuid,
              isUuid: true,
              visible: false,
              minfilter: 'linear',
              magfilter: 'linear',
              mipfilter: 'none',
              anisotropy: 0,
            },
            ver: '1.0.22',
            imported: true,
            files: ['.json'],
            subMetas: {},
          },
          f9941: {
            importer: 'sprite-frame',
            uuid: spriteFrameUuid,
            displayName,
            id: 'f9941',
            name: 'spriteFrame',
            userData: {
              trimThreshold: 1,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              trimX,
              trimY,
              width: trimWidth,
              height: trimHeight,
              rawWidth,
              rawHeight,
              borderTop: 0,
              borderBottom: 0,
              borderLeft: 0,
              borderRight: 0,
              packable: true,
              pixelsToUnit: 100,
              pivotX: 0.5,
              pivotY: 0.5,
              meshType: 0,
              vertices: {
                rawPosition: [
                  -halfWidth,
                  -halfHeight,
                  0,
                  halfWidth,
                  -halfHeight,
                  0,
                  -halfWidth,
                  halfHeight,
                  0,
                  halfWidth,
                  halfHeight,
                  0,
                ],
                indexes: [0, 1, 2, 2, 1, 3],
                uv: [0, rawHeight, rawWidth, rawHeight, 0, 0, rawWidth, 0],
                nuv: [0, 0, 1, 0, 0, 1, 1, 1],
                minPos: [-halfWidth, -halfHeight, 0],
                maxPos: [halfWidth, halfHeight, 0],
              },
              isUuid: true,
              imageUuidOrDatabaseUri: textureSubUuid,
              atlasUuid: '',
              trimType: 'auto',
            },
            ver: '1.0.12',
            imported: true,
            files: ['.json'],
            subMetas: {},
          },
        },
        userData: {
          type: 'sprite-frame',
          fixAlphaTransparencyArtifacts: false,
          hasAlpha: true,
          // This is the redirect emitted by Creator for image assets; the
          // actual SpriteFrame ref above remains the @f9941 child asset.
          redirect: textureSubUuid,
        },
      },
      null,
      2,
    )
  }

  // 每个 AnimationClip:写真正的 .anim(Cocos 3.x AnimationClip JSON)+ .anim.meta
  for (const anim of plan.animations) {
    const animName = `${anim.name}.anim`
    const animPath = `${plan.packFolder}/animations/${animName}`
    const animUuid = uuidForPath(animPath)
    let frameTime = 0
    const times = anim.frames.map((frame) => {
      const time = Number.isFinite(frame.time) ? frame.time : frameTime
      frameTime += frame.duration
      return time
    })
    const values = anim.frames.map((frame) => ({
      __uuid__: spriteFrameUuids.get(frame.spriteFramePath) || `frame:${frame.spriteFramePath}`,
      __expectedType__: 'cc.SpriteFrame',
    }))
    files[animPath] = JSON.stringify(
      {
        __type__: 'cc.AnimationClip',
        _name: anim.name,
        _objFlags: 0,
        __editorExtras__: {},
        _native: '',
        sample: anim.fps,
        speed: 1,
        wrapMode: anim.loop ? 2 : 1,
        enableTrsBlending: false,
        _duration: anim.duration,
        _hash: 0,
        _tracks: [
          {
            __type__: 'cc.animation.ObjectTrack',
            _binding: {
              __type__: 'cc.animation.TrackBinding',
              path: {
                __type__: 'cc.animation.TrackPath',
                _paths: [
                  { __type__: 'cc.animation.ComponentPath', component: 'cc.Sprite' },
                  'spriteFrame',
                ],
              },
            },
            _channel: {
              __type__: 'cc.animation.Channel',
              _curve: {
                __type__: 'cc.ObjectCurve',
                _times: times,
                _values: values,
              },
            },
          },
        ],
        _exoticAnimation: null,
        _events: [],
        _embeddedPlayers: [],
        _additiveSettings: {
          __type__: 'cc.AnimationClipAdditiveSettings',
          enabled: false,
          refClip: null,
        },
        _auxiliaryCurveEntries: [],
        _windupDirection: anim.direction,
      },
      null,
      2,
    )
    files[`${animPath}.meta`] = JSON.stringify(
      {
        ver: '1.0.0',
        uuid: animUuid,
        subMetas: {},
        _windupDirection: anim.direction,
      },
      null,
      2,
    )
  }

  // 主 Prefab
  const prefabUuid = uuidForPath(plan.prefab.cocosPath)
  const masterSlug = safeSegment(`${manifest.package.character_name}-master`, 'master')
  const masterCocosPath = `${plan.packFolder}/textures/${masterSlug}.png`
  const masterUuid = spriteFrameUuids.get(masterCocosPath)
  files[`${plan.prefab.cocosPath}.meta`] = JSON.stringify(
    {
      ver: '1.0.0',
      uuid: prefabUuid,
      asyncLoadAssets: false,
      autoReleaseAssets: false,
      subMetas: {},
    },
    null,
    2,
  )
  // Cocos Creator 3.x prefab files are serialized object arrays. The first
  // object is the prefab asset and `data` points at the root Node by numeric
  // id; a hand-written object tree makes the editor importer fail while it
  // resolves Node/Component references.
  const animationRefs = plan.animations.map((a) => ({
    __uuid__: uuidForPath(`${plan.packFolder}/animations/${a.name}.anim`),
  }))
  const firstAnimationRef = animationRefs[0] || null
  const prefabInfoId = 8
  const fileId = prefabFileId(`${plan.prefab.cocosPath}#prefab-info`)
  const uiFileId = prefabFileId(`${plan.prefab.cocosPath}#ui-transform`)
  const spriteFileId = prefabFileId(`${plan.prefab.cocosPath}#sprite`)
  const animationFileId = prefabFileId(`${plan.prefab.cocosPath}#animation`)
  files[plan.prefab.cocosPath] = JSON.stringify(
    [
      {
        __type__: 'cc.Prefab',
        _name: plan.prefab.nodeName,
        _objFlags: 0,
        _native: '',
        data: { __id__: 1 },
        optimizationPolicy: 0,
        asyncLoadAssets: false,
        persistent: false,
        _windupPack: packName,
      },
      {
        __type__: 'cc.Node',
        _name: plan.prefab.nodeName,
        _objFlags: 0,
        _parent: null,
        _children: [],
        _active: true,
        _components: [{ __id__: 2 }, { __id__: 4 }, { __id__: 6 }],
        _prefab: { __id__: prefabInfoId },
        _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
        _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
        _layer: 33554432,
        _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        _id: '',
      },
      {
        __type__: 'cc.UITransform',
        _name: '',
        _objFlags: 0,
        node: { __id__: 1 },
        _enabled: true,
        _priority: 0,
        _contentSize: {
          __type__: 'cc.Size',
          width: plan.prefab.canvas.w,
          height: plan.prefab.canvas.h,
        },
        _anchorPoint: {
          __type__: 'cc.Vec2',
          x: plan.prefab.anchor.x,
          y: plan.prefab.anchor.y,
        },
        _id: '',
        __prefab: { __id__: 3 },
      },
      {
        __type__: 'cc.CompPrefabInfo',
        fileId: uiFileId,
      },
      {
        __type__: 'cc.Sprite',
        _name: '',
        _objFlags: 0,
        node: { __id__: 1 },
        _enabled: true,
        _srcBlendFactor: 2,
        _dstBlendFactor: 4,
        _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
        _sharedMaterial: null,
        _spriteFrame: masterUuid ? { __uuid__: masterUuid } : null,
        _type: 0,
        _fillType: 0,
        _sizeMode: 0,
        _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 },
        _fillStart: 0,
        _fillRange: 0,
        _isTrimmedMode: false,
        _useGrayscale: false,
        _atlas: null,
        _id: '',
        __prefab: { __id__: 5 },
      },
      {
        __type__: 'cc.CompPrefabInfo',
        fileId: spriteFileId,
      },
      {
        __type__: 'cc.Animation',
        _name: '',
        _objFlags: 0,
        node: { __id__: 1 },
        _enabled: true,
        playOnLoad: Boolean(firstAnimationRef),
        _clips: animationRefs,
        _defaultClip: firstAnimationRef,
        _id: '',
        __prefab: { __id__: 7 },
      },
      {
        __type__: 'cc.CompPrefabInfo',
        fileId: animationFileId,
      },
      {
        __type__: 'cc.PrefabInfo',
        root: { __id__: 1 },
        asset: { __id__: 0 },
        fileId,
      },
    ],
    null,
    2,
  )

  return files
}

/**
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
function safeSegment(value, fallback) {
  const normalized = value.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

/**
 * Cocos' prefab fileId is a 24-character base64 token (not a UUID). Keep it
 * deterministic so repeated CLI imports produce stable prefab diffs while
 * still matching the editor's serialized format.
 * @param {string} path
 * @returns {string}
 */
function prefabFileId(path) {
  return createHash('sha1')
    .update(`windup-cocos-prefab:${path}`)
    .digest('base64')
    .replace(/=+$/g, '')
    .slice(0, 24)
}

/**
 * 计算"哪个 spriteFrame uuid 对应哪个文件路径",给 Cocos 端 / .meta 端用。
 * 实际上是 `frame:<cocosPath>` 的反向表。
 *
 * @param {ImportPlan} plan
 * @returns {Map<string, string>}
 */
export function buildSpriteFrameIndex(plan) {
  const idx = new Map()
  for (const sf of plan.spriteFrames) {
    idx.set(sf.cocosPath, sf.sourcePath)
  }
  return idx
}
