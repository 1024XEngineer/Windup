import type {
  AssetExportTarget,
  AssetExportTargetContext,
  AssetExportTargetFile,
  PlannedSequence,
} from './asset-export'
import type { GenericExportMetadata } from './contract'
import type { ExportAnchor, ExportPackageModel } from './model'

/** Creator 3.8.8 的真实 2D 资产导入、引用和 Prefab 定位验收状态。 */
export const COCOS_TARGET_READINESS = {
  ready: true,
  reason: '已通过 Cocos Creator 3.8.8 真实 2D 资产导入与引用校验',
} as const

/**
 * 通用层左上原点转为 Cocos Creator 左下原点;x 不变,y 上下翻转。
 * 在 0-1 归一化坐标下,新 y = 1 - 原 y。
 */
export function toCocosAnchor(anchor: ExportAnchor): ExportAnchor {
  return { x: anchor.x, y: 1 - anchor.y }
}

export const COCOS_IMPORT_SCHEMA_VERSION = 'windup-cocos-import-1.1.0'

interface CocosImportActionFrame {
  index: number
  file: string
  duration_ms: number | null
}

interface CocosImportAction {
  id: string
  name: string
  export_name: string
  direction: string
  fps: number
  timing_mode: 'constant-fps' | 'per-frame'
  loop: boolean
  quality_status: GenericExportMetadata['actions'][number]['quality_status']
  anchor: { x: number; y: number }
  anchor_cocos: { x: number; y: number }
  foot_y: number
  frames: readonly CocosImportActionFrame[]
  atlas: {
    file: string
    cols: number
    rows: number
    cell: { w: number; h: number }
  }
}

interface CocosImportManifest {
  schema_version: typeof COCOS_IMPORT_SCHEMA_VERSION
  experimental: true
  engine: 'cocos-creator'
  upstream_issue: 94
  package: {
    character_id: string
    character_name: string
    outfit_id: string
    outfit_name: string
    canvas: { w: number; h: number }
  }
  master: {
    file: string
    anchor: { x: number; y: number }
    anchor_cocos: { x: number; y: number }
  }
  actions: readonly CocosImportAction[]
}

function explicitFrameDuration(planItem: PlannedSequence, frameIndex: number): number | null {
  const frame = planItem.frames[frameIndex]
  if (frame === undefined) return null
  const explicit = frame.frame.durationMs
  if (typeof explicit === 'number' && explicit > 0) return explicit
  return null
}

function buildManifest(
  model: ExportPackageModel,
  metadata: GenericExportMetadata,
  plan: readonly PlannedSequence[],
): CocosImportManifest {
  if (metadata.actions.length !== plan.length) {
    throw new Error(
      `cocos-target: meta.json 动作数量 ${metadata.actions.length} 与 plan 数量 ${plan.length} 不一致`,
    )
  }

  const masterAnchor = { x: 0.5, y: 0.92 }
  return {
    schema_version: COCOS_IMPORT_SCHEMA_VERSION,
    experimental: true,
    engine: 'cocos-creator',
    upstream_issue: 94,
    package: {
      character_id: model.characterId,
      character_name: model.characterName,
      outfit_id: model.outfitId,
      outfit_name: model.outfitName,
      canvas: { w: model.canvas.width, h: model.canvas.height },
    },
    master: {
      file: 'character/master.png',
      anchor: masterAnchor,
      anchor_cocos: toCocosAnchor(masterAnchor),
    },
    actions: metadata.actions.map(
      (action: GenericExportMetadata['actions'][number], index: number) => {
        const planItem = plan[index]
        if (planItem === undefined) {
          throw new Error(`cocos-target: meta.json 缺少第 ${index} 个 plan 动作`)
        }
        return {
          id: action.id,
          name: action.name,
          export_name: planItem.exportName,
          direction: planItem.sequence.direction,
          fps: action.fps,
          timing_mode: planItem.frames.some(
            (frame) => typeof frame.frame.durationMs === 'number' && frame.frame.durationMs > 0,
          )
            ? 'per-frame'
            : 'constant-fps',
          loop: action.loop,
          quality_status: action.quality_status,
          anchor: { ...action.anchor },
          anchor_cocos: toCocosAnchor(action.anchor),
          foot_y: action.foot_y,
          frames: action.frames.map(
            (frame: GenericExportMetadata['actions'][number]['frames'][number], index: number) => ({
              index: frame.index,
              file: frame.file,
              duration_ms: explicitFrameDuration(planItem, index),
            }),
          ),
          atlas: { ...action.atlas },
        }
      },
    ),
  }
}

function buildReadme(model: ExportPackageModel): string {
  return `# Windup → Cocos Creator 导出(实验性)

这是 Windup 通用包之上的 **Cocos Creator 适配层**。

## 状态

\`experimental: true\`。本 target 不会自动生成 \`.anim\`、\`meta\`、UUID,
因为这些字段需要在真实 Creator 3.x 项目中实测;详见 Issue #94。
验证完成前,本包不能被声称"拖入即播放"。

## 本目录内容

- \`cocos-import.json\` — Windup 定义的中间清单(schema_version:
  \`${COCOS_IMPORT_SCHEMA_VERSION}\`)。Cocos 侧需要写一个一次性编辑器插件
  消费这份清单,按其 \`actions[*]\` 列表建立 SpriteFrame / AnimationClip
  / Prefab,并把 \`anchor_cocos\` 写入节点的 \`anchor\`,把 \`foot_y\` 写入
  对齐脚线约束。
- 通用层的 \`frames/<action>/*.png\` 与 \`atlas/<action>.png\` 保持原样,
  不被 target 修改;Cocos 侧的导入插件按 manifest 中的相对路径引用。
- 通用层 \`meta.json\` 仍是契约源;target 不重写锚点 / 帧率 / 帧数,
  只把"左上原点"的 anchor 翻转成 Cocos 的"左下原点"。

## 坐标规则

通用层原点在画布左上、y 轴向下;anchor 范围 0-1。
Cocos Creator 原点在画布左下、y 轴向上;本 target 输出 \`anchor_cocos = (x, 1-y)\`。
\`foot_y\` 是从画布顶部的像素距离,Cocos 节点可使用 \`(canvas.h - foot_y)\` 反算。

## 已知缺口

- 不生成 \`.anim\` 曲线、关键帧时间轴。
- 不生成 \`meta\` / UUID。
- 不绑定节点骨骼,仅静态精灵。

完成 Issue #94 验证后,只需扩展 \`cocosCreatorTarget.createFiles\` 即可,
不需要修改 \`meta.json\` 或通用打包逻辑。

## 参考

- 角色: ${model.characterName} (#${model.characterId})
- 造型: ${model.outfitName} (#${model.outfitId})
- 画布: ${model.canvas.width}×${model.canvas.height}
- Issue: https://github.com/1024XEngineer/Windup/issues/94
`
}

export const cocosCreatorTarget: AssetExportTarget = {
  id: 'cocos-creator',
  async createFiles(context: AssetExportTargetContext): Promise<readonly AssetExportTargetFile[]> {
    const manifest = buildManifest(context.model, context.metadata, context.plan)
    return [
      {
        path: 'cocos-import.json',
        data: `${JSON.stringify(manifest, null, 2)}\n`,
      },
      {
        path: 'README.md',
        data: buildReadme(context.model),
      },
    ]
  },
}
