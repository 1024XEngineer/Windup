// 硬验证 CLI 输出:逐文件解析,PNG 真的能解出像素,.meta 里有合法 uuid,
// prefab/anim 里的 __uuid__ 引用都能在 .meta 里找到。退出码 0 = 全过,非 0 = 有错。
//
// 用法: node test/verify-output.mjs <cli-output-dir> [<expected-canvas-w> <expected-canvas-h>]

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const args = process.argv.slice(2)
if (args.length === 0) {
  // eslint-disable-next-line no-console
  console.error('用法: node test/verify-output.mjs <cli-output-dir> [canvas-w canvas-h]')
  process.exit(2)
}
const outDir = resolve(process.cwd(), args[0])
const expectW = args[1] ? Number(args[1]) : 64
const expectH = args[2] ? Number(args[2]) : 64

let fails = 0
function pass(label) {
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${label}`)
}
function fail(label, why) {
  fails += 1
  // eslint-disable-next-line no-console
  console.log(`  ✗ ${label} — ${why}`)
}

if (!existsSync(outDir)) {
  // eslint-disable-next-line no-console
  console.error(`输出目录不存在: ${outDir}`)
  process.exit(1)
}

// ── PNG 解码器(只解 IHDR + 算 IDAT 解压字节数,验证尺寸/类型,不深解像素) ──
function parsePng(bytes) {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error('PNG signature missing')
  }
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let idatBytes = 0
  let iend = false
  while (off + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(off)
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7])
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(off + 8)
      height = bytes.readUInt32BE(off + 12)
      bitDepth = bytes[off + 16]
      colorType = bytes[off + 17]
    } else if (type === 'IDAT') {
      idatBytes += len
    } else if (type === 'IEND') {
      iend = true
      off += 8 + len + 4
      break
    }
    off += 8 + len + 4
  }
  if (width === 0) throw new Error('no IHDR')
  if (!iend) throw new Error('no IEND')
  return { width, height, bitDepth, colorType, idatBytes }
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

// eslint-disable-next-line no-console
console.log(`验证 ${outDir} (期望 canvas ${expectW}x${expectH})\n`)

const allFiles = walk(outDir)
const pngs = allFiles.filter((f) => f.endsWith('.png'))
const metas = allFiles.filter((f) => f.endsWith('.meta'))
const prefabs = allFiles.filter((f) => f.endsWith('.prefab') && !f.endsWith('.meta'))
const animMetas = allFiles.filter((f) => f.endsWith('.anim.meta'))
const anims = allFiles.filter((f) => f.endsWith('.anim') && !f.endsWith('.meta'))
const manifestPath = join(outDir, 'cocos-import.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : null
const expectedActions = new Map((manifest?.actions ?? []).map((action) => [action.export_name, action]))

// eslint-disable-next-line no-console
console.log(
  `发现 ${pngs.length} 个 PNG, ${metas.length} 个 .meta, ${prefabs.length} 个 .prefab, ${anims.length} 个 .anim (${animMetas.length} .anim.meta)`,
)

// ── Step 0: 建 UUID → file 映射表(.meta 顶层和 SpriteFrame 子资源) ──
const uuidToFile = new Map()
for (const meta of metas) {
  try {
    const j = JSON.parse(readFileSync(meta, 'utf-8'))
    if (typeof j.uuid === 'string' && j.uuid.length > 0) {
      uuidToFile.set(j.uuid, meta.slice(0, -'.meta'.length))
    }
    if (j.subMetas && typeof j.subMetas === 'object') {
      for (const [name, subMeta] of Object.entries(j.subMetas)) {
        if (subMeta && typeof subMeta.uuid === 'string' && subMeta.uuid.length > 0) {
          const childName = subMeta.name === 'spriteFrame' || name === 'f9941' ? 'spriteFrame' : name
          uuidToFile.set(subMeta.uuid, `${meta.slice(0, -'.meta'.length)}#${childName}`)
        }
      }
    }
  } catch {
    // ignore
  }
}
// eslint-disable-next-line no-console
console.log(`\nUUID 索引: ${uuidToFile.size} 个 uuid\n`)

// ── Step 1: 验 PNG 全部能解 + 尺寸对得上 ──
const expectedFrameSize = `${expectW}x${expectH}`
for (const png of pngs) {
  try {
    const bytes = readFileSync(png)
    const info = parsePng(bytes)
    const key = `${info.width}x${info.height}`
    const isAtlas = /[\\/]atlas\.png$/.test(png)
    const validAtlasSize = isAtlas && info.width >= expectW && info.height >= expectH && info.width % expectW === 0 && info.height % expectH === 0
    if (key !== expectedFrameSize && !validAtlasSize) {
      fail(relative(outDir, png), `尺寸 ${key} 不符合帧 ${expectedFrameSize} 或整格图集尺寸`)
    } else if (info.colorType !== 6 || info.bitDepth !== 8) {
      fail(relative(outDir, png), `颜色类型 ${info.colorType} bit ${info.bitDepth} (期望 RGBA/8)`)
    } else if (info.idatBytes === 0) {
      fail(relative(outDir, png), 'IDAT 字节为 0')
    } else {
      pass(`${relative(outDir, png)} (${key} RGBA8, IDAT ${info.idatBytes}B)`)
    }
  } catch (err) {
    fail(relative(outDir, png), err.message)
  }
}

// ── Step 2: 验 .meta 与 PNG 尺寸对得上 + SpriteFrame 子资源 UUID 正确 ──
for (const meta of metas) {
  if (meta.endsWith('.prefab.meta') || meta.endsWith('.anim.meta')) {
    try {
      const j = JSON.parse(readFileSync(meta, 'utf-8'))
      if (typeof j.uuid !== 'string' || j.uuid.length < 8) {
        fail(relative(outDir, meta), `uuid 字段缺失或过短: ${j.uuid}`)
      } else {
        pass(`${relative(outDir, meta)} (uuid=${j.uuid.slice(0, 8)}…)`)
      }
    } catch (err) {
      fail(relative(outDir, meta), err.message)
    }
    continue
  }
  try {
    const j = JSON.parse(readFileSync(meta, 'utf-8'))
    if (j.importer !== 'image') {
      pass(`${relative(outDir, meta)} (${j.importer ?? 'metadata'})`)
      continue
    }
    const png = meta.slice(0, -'.meta'.length)
    if (!existsSync(png)) {
      fail(relative(outDir, meta), '找不到对应 PNG')
      continue
    }
    if (typeof j.uuid !== 'string' || j.uuid.length < 8) {
      fail(relative(outDir, meta), `uuid 字段缺失`)
    } else {
      const subMeta = j.subMetas?.spriteFrame ?? j.subMetas?.f9941
      const pngInfo = parsePng(readFileSync(png))
      const spriteFrameUserData = subMeta?.userData ?? subMeta
      if (
        !subMeta ||
        typeof subMeta.uuid !== 'string' ||
        !subMeta.uuid.endsWith('@f9941') ||
        !j.subMetas?.['6c48a']?.uuid?.endsWith('@6c48a') ||
        spriteFrameUserData.imageUuidOrDatabaseUri !== j.subMetas['6c48a'].uuid
      ) {
        fail(relative(outDir, meta), '缺少 SpriteFrame 子资源 UUID 或 rawTextureUuid 链接')
      } else if (
        spriteFrameUserData.rawWidth !== pngInfo.width ||
        spriteFrameUserData.rawHeight !== pngInfo.height
      ) {
        fail(relative(outDir, meta), `SpriteFrame raw size ${spriteFrameUserData.rawWidth}x${spriteFrameUserData.rawHeight} ≠ PNG ${pngInfo.width}x${pngInfo.height}`)
      } else if (
        spriteFrameUserData.trimX < 0 ||
        spriteFrameUserData.trimY < 0 ||
        spriteFrameUserData.width <= 0 ||
        spriteFrameUserData.height <= 0 ||
        spriteFrameUserData.trimX + spriteFrameUserData.width > pngInfo.width ||
        spriteFrameUserData.trimY + spriteFrameUserData.height > pngInfo.height
      ) {
        fail(relative(outDir, meta), 'SpriteFrame 裁剪矩形超出 PNG 原始画布')
      } else {
        pass(`${relative(outDir, meta)} (texture=${j.uuid.slice(0, 8)}…, spriteFrame=${subMeta.uuid.slice(0, 8)}…, raw ${pngInfo.width}x${pngInfo.height})`)
      }
    }
  } catch (err) {
    fail(relative(outDir, meta), err.message)
  }
}

// ── Step 3: 验 .anim(真 AnimationClip JSON)结构 + uuid 引用链 ──
for (const a of anims) {
  try {
    const j = JSON.parse(readFileSync(a, 'utf-8'))
    if (j.__type__ !== 'cc.AnimationClip') {
      fail(relative(outDir, a), `__type__=${j.__type__}`)
      continue
    }
    if (j.wrapMode !== 1 && j.wrapMode !== 2) {
      fail(relative(outDir, a), `wrapMode ${j.wrapMode}`)
      continue
    }
    const objectTrack = j._tracks?.find((track) => track?.__type__ === 'cc.animation.ObjectTrack')
    const paths = objectTrack?._binding?.path?._paths
    const curve = objectTrack?._channel?._curve
    const times = curve?._times
    const frameRefs = curve?._values
    const expectedAction = expectedActions.get(j._name)
    if (
      j._duration <= 0 ||
      !Array.isArray(paths) ||
      paths[0]?.__type__ !== 'cc.animation.ComponentPath' ||
      paths[0]?.component !== 'cc.Sprite' ||
      paths[1] !== 'spriteFrame' ||
      curve?.__type__ !== 'cc.ObjectCurve' ||
      !Array.isArray(times) ||
      !Array.isArray(frameRefs) ||
      frameRefs.length < 1 ||
      times.length !== frameRefs.length ||
      times.some((time, index) => index > 0 && time <= times[index - 1])
    ) {
      fail(relative(outDir, a), 'Creator 3.8 SpriteFrame 对象轨道无效')
      continue
    }
    if (expectedAction) {
      const expectedWrapMode = expectedAction.loop ? 2 : 1
      if (frameRefs.length !== expectedAction.frames.length) {
        fail(relative(outDir, a), `动画关键帧 ${frameRefs.length} ≠ manifest ${expectedAction.frames.length}`)
      }
      if (j.sample !== expectedAction.fps) {
        fail(relative(outDir, a), `sample ${j.sample} ≠ manifest fps ${expectedAction.fps}`)
      }
      if (j.wrapMode !== expectedWrapMode) {
        fail(relative(outDir, a), `wrapMode ${j.wrapMode} ≠ manifest loop=${expectedAction.loop}`)
      }
    }
    pass(`${relative(outDir, a)} (AnimationClip ${j._duration}s @ ${j.sample}fps, wrapMode=${j.wrapMode}, ${frameRefs.length} keys)`)
    // 检查每个 frame key 的 __uuid__ 在 UUID 索引里能找到
    for (const frameRef of frameRefs) {
      const ref = String(frameRef?.__uuid__ ?? '')
      if (!ref) {
        fail(relative(outDir, a), 'frame key 缺 __uuid__')
      } else if (ref.startsWith('frame:')) {
        // 兜底伪引用(理论上不应出现):检查路径存在
        const p = ref.replace(/^frame:/, '')
        if (!existsSync(join(outDir, p))) {
          fail(relative(outDir, a), `frame: 兜底引用 ${p} 不在输出目录`)
        }
      } else if (!uuidToFile.has(ref)) {
        fail(relative(outDir, a), `__uuid__ ${ref.slice(0, 8)}… 在 .meta 索引中找不到`)
      } else if (!uuidToFile.get(ref).includes('#spriteFrame')) {
        fail(relative(outDir, a), `__uuid__ ${ref.slice(0, 8)}… 不是 SpriteFrame 子资源`)
      } else {
        pass(`${relative(outDir, a)} frame → uuid ${ref.slice(0, 8)}… (${relative(outDir, uuidToFile.get(ref))})`)
      }
    }
  } catch (err) {
    fail(relative(outDir, a), err.message)
  }
}

// ── Step 4: 验 .prefab 结构 + sprite/anim uuid 引用链 ──
for (const pf of prefabs) {
  try {
    const j = JSON.parse(readFileSync(pf, 'utf-8'))
    const prefabAsset = Array.isArray(j) ? j[0] : j
    if (prefabAsset?.__type__ !== 'cc.Prefab') {
      fail(relative(outDir, pf), `__type__=${prefabAsset?.__type__}`)
      continue
    }
    const objects = Array.isArray(j) ? j : null
    const resolveRef = (value) => {
      if (!objects || !value || !Number.isInteger(value.__id__)) return value
      return objects[value.__id__]
    }
    const root = resolveRef(prefabAsset.data)
    pass(`${relative(outDir, pf)} (cc.Prefab, _name=${prefabAsset._name})`)
    const components = (root?._components ?? []).map(resolveRef)
    const uiTransform = components.find((component) => component?.__type__ === 'cc.UITransform')
    const sprite = components.find((component) => component?.__type__ === 'cc.Sprite')
    const animation = components.find((component) => component?.__type__ === 'cc.Animation')
    if (uiTransform?._contentSize?.width !== expectW || uiTransform?._contentSize?.height !== expectH) {
      fail(relative(outDir, pf), `UITransform 不是稳定的 ${expectW}x${expectH}`)
    } else {
      pass(`${relative(outDir, pf)} UITransform=${expectW}x${expectH}`)
    }
    if (sprite?._sizeMode !== 0 || sprite?._isTrimmedMode !== false) {
      fail(relative(outDir, pf), 'Sprite 必须使用 CUSTOM size 且关闭 trimmed mode')
    } else {
      pass(`${relative(outDir, pf)} Sprite=CUSTOM, trimmed=false`)
    }
    if (!animation || animation.playOnLoad !== true || animation._clips?.length !== expectedActions.size) {
      fail(relative(outDir, pf), `Animation 组件未包含 ${expectedActions.size} 个可自动播放 clip`)
    } else {
      pass(`${relative(outDir, pf)} Animation=${animation._clips.length} clips, playOnLoad=true`)
    }
    // 找所有 _spriteFrame.__uuid__
    const allSpriteRefs = []
    function walkNode(nodeValue) {
      const n = resolveRef(nodeValue)
      if (!n) return
      if (Array.isArray(n._components)) {
        for (const componentRef of n._components) {
          const c = resolveRef(componentRef)
          if (c?._spriteFrame?.__uuid__) allSpriteRefs.push(c._spriteFrame.__uuid__)
        }
      }
      if (Array.isArray(n._children)) for (const c of n._children) walkNode(c)
    }
    walkNode(root)
    for (const ref of allSpriteRefs) {
      if (!uuidToFile.has(ref)) {
        fail(relative(outDir, pf), `sprite __uuid__ ${ref.slice(0, 8)}… 在 .meta 索引中找不到`)
      } else if (!uuidToFile.get(ref).includes('#spriteFrame')) {
        fail(relative(outDir, pf), `sprite __uuid__ ${ref.slice(0, 8)}… 不是 SpriteFrame 子资源`)
      } else {
        pass(`${relative(outDir, pf)} sprite → uuid ${ref.slice(0, 8)}… (${relative(outDir, uuidToFile.get(ref))})`)
      }
    }
    // 找所有 _clips[].__uuid__
    const allAnimRefs = []
    function walkComps(nodeValue) {
      const n = resolveRef(nodeValue)
      if (!n) return
      if (Array.isArray(n._components)) {
        for (const componentRef of n._components) {
          const c = resolveRef(componentRef)
          if (c?.__type__ === 'cc.Animation' && Array.isArray(c._clips)) {
            for (const cl of c._clips) if (cl?.__uuid__) allAnimRefs.push(cl.__uuid__)
          }
        }
      }
      if (Array.isArray(n._children)) for (const child of n._children) walkComps(child)
    }
    walkComps(root)
    for (const ref of allAnimRefs) {
      if (!uuidToFile.has(ref)) {
        fail(relative(outDir, pf), `anim __uuid__ ${ref.slice(0, 8)}… 在 .meta 索引中找不到`)
      } else {
        pass(`${relative(outDir, pf)} anim → uuid ${ref.slice(0, 8)}… (${relative(outDir, uuidToFile.get(ref))})`)
      }
    }
  } catch (err) {
    fail(relative(outDir, pf), err.message)
  }
}

// eslint-disable-next-line no-console
console.log(`\n=== 结果: ${fails === 0 ? '全过' : `${fails} 项失败`} ===`)
process.exit(fails === 0 ? 0 : 1)
