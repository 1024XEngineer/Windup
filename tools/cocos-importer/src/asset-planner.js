// 决定把 Windup 适配包里的哪些文件落到 Cocos 工程的哪个位置,
// 产出 SpriteFrame / AnimationClip / Prefab 三类资产的元数据。
// 输出是计划,真正落盘交给 adapter(Node CLI 或 Cocos 扩展)。

/**
 * @typedef {import('./manifest-reader.js').WindupCocosManifest} WindupCocosManifest
 */

/**
 * @typedef {{
 *   packFolder: string,           // 例如 'windup-imports/Hero/Ranger'
 *   spriteFrames: Array<{
 *     sourcePath: string,         // ZIP 内相对路径,例如 'character/master.png'
 *     cocosPath: string,          // 目标 Cocos 资产路径
 *     rect: { x: number, y: number, w: number, h: number },
 *     trim: { x: number, y: number, w: number, h: number },
 *   }>,
 *   animations: Array<{
 *     id: string,
 *     name: string,
 *     direction: string,
 *     fps: number,
 *     loop: boolean,
 *     duration: number,           // 秒
 *     frames: Array<{ spriteFramePath: string, index: number, time: number, duration: number }>,
 *   }>,
 *   prefab: {
 *     name: string,
 *     cocosPath: string,
 *     nodeName: string,
 *     anchor: { x: number, y: number },
 *     footY: number,
 *     canvas: { w: number, h: number },
 *   },
 * }} ImportPlan
 */

/**
 * @param {WindupCocosManifest} manifest
 * @returns {ImportPlan}
 */
export function planImport(manifest) {
  const characterSlug = safeSegment(manifest.package.character_name, 'character')
  const outfitSlug = safeSegment(manifest.package.outfit_name, 'outfit')
  const packFolder = `windup-imports/${characterSlug}/${outfitSlug}`

  const spriteFrames = []
  const animations = []
  const usedNames = new Set()

  // master → 单张 SpriteFrame
  const masterSlug = safeSegment(`${characterSlug}-master`, 'master')
  spriteFrames.push({
    sourcePath: manifest.master.file,
    cocosPath: `${packFolder}/textures/${masterSlug}.png`,
    rect: { x: 0, y: 0, w: manifest.package.canvas.w, h: manifest.package.canvas.h },
    trim: { x: 0, y: 0, w: manifest.package.canvas.w, h: manifest.package.canvas.h },
  })

  for (const action of manifest.actions) {
    const actionSlug = safeSegment(action.export_name, 'action')
    const uniqueName = actionSlug
    if (usedNames.has(uniqueName)) {
      throw new Error(`动作名重复: ${uniqueName}(同一适配包内 export_name 必须唯一)`)
    }
    usedNames.add(uniqueName)

    const cellW = action.atlas.cell.w
    const cellH = action.atlas.cell.h
    const cols = action.atlas.cols
    const legacyTiming = action.timing_mode === undefined
    const fallbackSeconds = legacyTiming ? Math.round(1000 / action.fps) / 1000 : 1 / action.fps
    const frameDurations = action.frames.map((frame) =>
      typeof frame.duration_ms === 'number' && frame.duration_ms > 0
        ? frame.duration_ms / 1000
        : fallbackSeconds,
    )
    const frameTimes = []
    let elapsed = 0
    for (let index = 0; index < action.frames.length; index += 1) {
      frameTimes.push(action.timing_mode === 'constant-fps' ? index / action.fps : elapsed)
      elapsed += frameDurations[index] ?? 0
    }

    // 每张 frame → SpriteFrame(atlas 子区域)
    // 注意:manifest 里 frame.file 是 basename(Walk_000.png),但 ZIP 里
    // 实际路径是 frames/<action.export_name>/<file>。需要拼完整路径去找源图。
    const spriteFramePaths = []
    action.frames.forEach((frame) => {
      const spriteSlug = `${uniqueName}_${String(frame.index).padStart(3, '0')}`
      const sfPath = `${packFolder}/animations/${uniqueName}/${spriteSlug}.png`
      spriteFramePaths.push(sfPath)
      spriteFrames.push({
        sourcePath: `frames/${action.export_name}/${frame.file}`,
        cocosPath: sfPath,
        // 这里复制的是单帧 PNG,不是 atlas;每张单帧纹理的 SpriteFrame
        // 裁剪原点都必须是(0,0),否则后续帧会被按 atlas 偏移裁成空图。
        rect: { x: 0, y: 0, w: cellW, h: cellH },
        trim: { x: 0, y: 0, w: cellW, h: cellH },
      })
    })

    // 整张 atlas → 单张图集纹理(Windup 输出是一张大图,Cocos SpriteAtlas 需要它)
    const atlasSlug = uniqueName
    spriteFrames.push({
      sourcePath: action.atlas.file,
      cocosPath: `${packFolder}/animations/${atlasSlug}/atlas.png`,
      rect: { x: 0, y: 0, w: cellW * cols, h: cellH * Math.ceil(action.frames.length / cols) },
      trim: { x: 0, y: 0, w: cellW * cols, h: cellH * Math.ceil(action.frames.length / cols) },
    })

    const durationSec = action.timing_mode === 'constant-fps'
      ? action.frames.length / action.fps
      : frameDurations.reduce((sum, duration) => sum + duration, 0)
    animations.push({
      id: action.id,
      name: uniqueName,
      direction: action.direction,
      fps: action.fps,
      loop: action.loop,
      duration: durationSec,
      frames: action.frames.map((frame, idx) => ({
        spriteFramePath: spriteFramePaths[idx],
        index: frame.index,
        time: frameTimes[idx] ?? 0,
        duration: frameDurations[idx] ?? 0,
      })),
    })
  }

  // prefab:节点带 Sprite(主母版) + Animation 组件(指向第一个动作)
  const prefabName = `${characterSlug}-${outfitSlug}`
  const firstAction = animations[0]
  return {
    packFolder,
    spriteFrames,
    animations,
    prefab: {
      name: prefabName,
      cocosPath: `${packFolder}/prefabs/${prefabName}.prefab`,
      nodeName: prefabName,
      anchor: manifest.master.anchor_cocos,
      footY: manifest.master.foot_y ?? 0,
      canvas: manifest.package.canvas,
      defaultAnimation: firstAction ? firstAction.name : null,
    },
  }
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
