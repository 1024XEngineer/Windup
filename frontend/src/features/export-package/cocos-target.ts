import type { ExportAnchor } from './model'
import type { AssetExportTarget, PlannedSequence } from './asset-export'
import type { GenericExportAction } from './contract'

export const COCOS_TARGET_READINESS = {
  ready: true,
  reason: '输出 Cocos Creator 3.x 文档支持的同名 TexturePacker PNG 与 plist 图集文件',
} as const

/** 通用层左上原点转为 Cocos Creator 左下原点；x 不变，y 上下翻转。 */
export function toCocosAnchor(anchor: ExportAnchor): ExportAnchor {
  return { x: anchor.x, y: Number((1 - anchor.y).toFixed(6)) }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function createTexturePackerPlist(
  item: PlannedSequence,
  canvas: { width: number; height: number },
) {
  const frames = item.frames
    .map((frame) => {
      const column = frame.index % item.columns
      const row = Math.floor(frame.index / item.columns)
      const x = column * canvas.width
      const y = row * canvas.height
      return `    <key>${xmlEscape(frame.filename)}</key>
    <dict>
      <key>frame</key><string>{{${x},${y}},{${canvas.width},${canvas.height}}}</string>
      <key>offset</key><string>{0,0}</string>
      <key>rotated</key><false/>
      <key>sourceColorRect</key><string>{{0,0},{${canvas.width},${canvas.height}}}</string>
      <key>sourceSize</key><string>{${canvas.width},${canvas.height}}</string>
    </dict>`
    })
    .join('\n')
  const textureName = `${item.exportName}.png`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>frames</key>
  <dict>
${frames}
  </dict>
  <key>metadata</key>
  <dict>
    <key>format</key><integer>3</integer>
    <key>realTextureFileName</key><string>${xmlEscape(textureName)}</string>
    <key>size</key><string>{${item.columns * canvas.width},${item.rows * canvas.height}}</string>
    <key>textureFileName</key><string>${xmlEscape(textureName)}</string>
  </dict>
</dict>
</plist>
`
}

function animationManifest(item: PlannedSequence, action: GenericExportAction) {
  return {
    id: action.id,
    name: action.name,
    direction: action.direction,
    loop: action.loop,
    fps: action.fps,
    atlas: `atlases/${item.exportName}.png`,
    plist: `atlases/${item.exportName}.plist`,
    anchor: toCocosAnchor(action.anchor),
    foot_y: action.foot_y,
    frames: action.frames.map((frame) => ({
      sprite_frame: frame.file,
      duration_ms: frame.duration_ms,
    })),
  }
}

export const COCOS_CREATOR_TARGET: AssetExportTarget = {
  id: 'cocos-creator-3x',
  async createFiles({ model, metadata, plan, readFile }) {
    const files = plan.flatMap((item) => {
      const atlas = readFile(item.atlasFile)
      if (atlas === null) throw new Error(`${item.atlasFile}: Cocos target 找不到通用 PNG 图集`)
      return [
        { path: `atlases/${item.exportName}.png`, data: atlas },
        {
          path: `atlases/${item.exportName}.plist`,
          data: createTexturePackerPlist(item, model.canvas),
        },
      ]
    })
    const animations = plan.map((item) => {
      const action = metadata.actions.find(
        (candidate) =>
          candidate.id === item.action.id && candidate.direction === item.sequence.direction,
      )
      if (!action) throw new Error(`${item.exportName}: Cocos target 找不到动作元数据`)
      return animationManifest(item, action)
    })
    files.push({
      path: 'windup-animation.json',
      data: JSON.stringify(
        {
          engine: 'cocos-creator-3.x',
          source_schema_version: metadata.schema_version,
          animations,
        },
        null,
        2,
      ),
    })
    return files
  },
}
