/**
 * 浏览器出帧驱动 —— 后端 `bake_driver.mjs` 的同位替代(#714)。
 *
 * 那份用 Playwright 驱动无头 Chromium,跑在 4 核无 GPU 的应用机上只能走 SwiftShader
 * 软件光栅(实测峰值想吃 7.6 个核);这份跑在用户浏览器里,用的是用户自己的显卡。
 *
 * **判定不跟着搬。** 帧数对账、空帧自检、脚线对齐、成色闸仍在服务端做 —— 这里做的
 * 自检只是"早点炸",不是替服务端把关。客户端自报的数只是它的说法。
 */
import { BakeStage, StageError, resolveClip } from './stage'

import type { BakeJob, Render3DApis } from '@/entities/render3d'

export { BakeStage, StageError, MATERIALS, isStageMaterial, resolveClip } from './stage'
export type { StageMaterial, StageRigInfo } from './stage'

export interface BakeProgress {
  /** 已交帧数。 */
  done: number
  total: number
}

export interface RunClientBakeOptions {
  job: BakeJob
  apis: Render3DApis
  onProgress?: (progress: BakeProgress) => void
  signal?: AbortSignal
  /** 判黑后的等待。测试注入,免得真等几秒。 */
  sleep?: (ms: number) => Promise<void>
}

/** 出帧中途被放弃(用户离开页面 / 上层取消)。不当失败上报,任务留给期限兜底。 */
export class BakeAborted extends Error {
  constructor() {
    super('出帧已取消')
    this.name = 'BakeAborted'
  }
}

/**
 * 跑完一个出帧任务:拉模型 → 逐帧渲 → 逐帧传 → 报交齐。
 *
 * 任何一步失败都要**主动告诉后端**,否则这笔冻结的积分要等满期限才解冻,用户在界面上
 * 看到的是一个一直转的进度条。只有"取消"不上报 —— 那是用户自己的动作。
 */
/** 主体平均亮度下限。纯黑剪影量到 0.0,正常帧量到约 148 —— 取 20 只拦「全黑」。 */
const MIN_SUBJECT_LUMA = 20

/** 判黑后重试几次、每次等多久。贴图解码是几百毫秒的事,给到 3 秒是十倍余量。 */
const BLACK_FRAME_RETRIES = 10
const BLACK_FRAME_WAIT_MS = 300

export async function runClientBake(options: RunClientBakeOptions): Promise<void> {
  const { job, apis, onProgress, signal } = options
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const throwIfAborted = () => {
    if (signal?.aborted) throw new BakeAborted()
  }

  let stage: BakeStage | null = null
  try {
    throwIfAborted()
    stage = await BakeStage.create({
      modelUrl: job.modelUrl,
      material: job.material,
      width: job.width,
      height: job.height,
    })
    const clips = stage.availableClips()
    if (!Object.keys(clips).length) {
      throw new StageError('模型里没有任何动画片段 —— 绑骨时没带 MotionType?')
    }
    // 片段名由绑骨接口按任务哈希起,对不上产品动作名是常态,见 resolveClip。
    const clip = resolveClip(job.clip, Object.keys(clips))
    stage.setCamYaw(job.cameraYaw)

    const sampleTimes: number[] = []
    for (let i = 0; i < job.frames; i++) {
      throwIfAborted()
      sampleTimes.push(stage.setup(clip, i, job.frames))
      const coverage = stage.coverage()
      if (coverage < job.minCoverage) {
        // 角色出画或片段选错都会安静地产出全透明帧,而外面照样以为成功了。
        throw new StageError(
          `第 ${i} 帧几乎全透明(覆盖率 ${coverage.toFixed(5)} < ${job.minCoverage})`,
        )
      }
      // 纯黑主体逃得过覆盖率那道闸(它只数 alpha),所以在这里再判一次亮度。
      // 触发点几乎只有一个:贴图还没解码完就渲了。
      //
      // **判黑之后先重试,不直接失败。** compileAsync 只保证着色器编译与已解码贴图
      // 的上传,不等图片本身解码 —— 实测线上仍会在第 0 帧撞上。而这是个纯等待问题:
      // 再渲一次就好了。直接失败等于把一个几百毫秒能自愈的状况变成整单报废。
      let luma = stage.subjectLuma()
      for (let k = 0; luma >= 0 && luma < MIN_SUBJECT_LUMA && k < BLACK_FRAME_RETRIES; k++) {
        await sleep(BLACK_FRAME_WAIT_MS)
        luma = stage.subjectLuma()
      }
      if (luma >= 0 && luma < MIN_SUBJECT_LUMA) {
        throw new StageError(
          `第 ${i} 帧主体是纯黑(平均亮度 ${luma.toFixed(1)} < ${MIN_SUBJECT_LUMA})，` +
            `等了 ${(BLACK_FRAME_RETRIES * BLACK_FRAME_WAIT_MS) / 1000} 秒仍未就绪`,
        )
      }
      await apis.putBakeFrame(job.taskId, i, await stage.grab())
      onProgress?.({ done: i + 1, total: job.frames })
    }
    throwIfAborted()
    // 骨架事实与根骨位移轨随交齐一起回传（#774）。服务端渲那条会把它们带上来，
    // 这条此前算完即随页面销毁 —— 两条路必须交回同样的东西。
    const rig = stage.rigInfo()
    await apis.completeBake(job.taskId, {
      clip: job.clip,
      sampleTimes,
      rig: {
        bones: rig.bones,
        rootBone: rig.rootBone,
        boneNames: rig.boneNames,
        skinnedMeshes: rig.skinned,
        vertices: rig.verts,
        availableClips: clips,
      },
      rootMotion: stage.rootMotionOf(job.clip),
    })
  } catch (error) {
    if (error instanceof BakeAborted) throw error
    await apis
      .failBake(job.taskId, error instanceof Error ? error.message : String(error))
      .catch(() => undefined)
    throw error
  } finally {
    stage?.dispose()
  }
}
