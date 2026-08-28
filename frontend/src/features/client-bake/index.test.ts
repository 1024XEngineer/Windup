import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BakeCompletion } from '@/entities'
import { bakeJob, stubRender3DApis } from '@/test/render3d-apis'

const stage = vi.hoisted(() => ({
  clips: { walk: 1.0667 } as Record<string, number>,
  coverage: 0.01,
  luma: 148,
  setups: [] as Array<[string, number, number]>,
  yaw: null as number | null,
  disposed: 0,
  grabError: null as Error | null,
  createError: null as Error | null,
  createdContexts: 0,
}))

vi.mock('./stage', async () => {
  const actual = await vi.importActual<typeof import('./stage')>('./stage')
  return {
    ...actual,
    BakeStage: {
      create: vi.fn(async () => {
        stage.createdContexts++
        if (stage.createError) {
          // 真实现在 load 失败时会先 dispose 再抛;替身照做,否则这条用例测不到东西。
          stage.disposed++
          throw stage.createError
        }
        return {
          availableClips: () => stage.clips,
          setCamYaw: (deg: number) => {
            stage.yaw = deg
          },
          setup: (clip: string, i: number, n: number) => {
            stage.setups.push([clip, i, n])
            return i * 0.1
          },
          coverage: () => stage.coverage,
          subjectLuma: () => stage.luma,
          rigInfo: () => ({
            loader: 'gltf',
            rootBone: 'Hips',
            bones: 28,
            boneNames: ['Hips', 'Spine'],
            skinned: 1,
            verts: 51388,
            orthoH: 5.95,
            material: 'cel',
          }),
          rootMotionOf: () => [
            [0, 0],
            [0.1, 0],
          ],
          grab: async () => {
            if (stage.grabError) throw stage.grabError
            return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
          },
          dispose: () => {
            stage.disposed++
          },
        }
      }),
    },
  }
})

const { runClientBake, BakeAborted } = await import('.')

beforeEach(() => {
  stage.clips = { walk: 1.0667 }
  stage.coverage = 0.01
  stage.luma = 148
  stage.setups = []
  stage.yaw = null
  stage.disposed = 0
  stage.grabError = null
  stage.createError = null
  stage.createdContexts = 0
})

describe('浏览器出帧驱动', () => {
  it('按 plan 的朝向与帧数逐帧交付,最后报交齐', async () => {
    const uploaded: number[] = []
    // 用数组收而不是可空变量：赋值发生在异步回调里，TS 的控制流分析会把
    // 可空变量在断言处窄化成 null，读它的字段就报 never。
    const completed: BakeCompletion[] = []
    const apis = stubRender3DApis({
      putBakeFrame: async (_taskId, index) => {
        uploaded.push(index)
        return uploaded.length
      },
      completeBake: async (_taskId, completion) => {
        completed.push(completion)
      },
    })
    const job = bakeJob({ frames: 3, cameraYaw: 90, direction: 'n' })
    await runClientBake({ job, apis })

    expect(stage.yaw).toBe(90)
    expect(stage.setups).toEqual([
      ['walk', 0, 3],
      ['walk', 1, 3],
      ['walk', 2, 3],
    ])
    expect(uploaded).toEqual([0, 1, 2])
    // 骨架事实与位移轨随交齐一起回传（#774）——服务端渲那条会带上来，这条也必须带。
    expect(completed).toHaveLength(1)
    const done = completed[0]!
    expect(done.clip).toBe('walk')
    expect(done.sampleTimes).toEqual([0, 0.1, 0.2])
    expect(done.rig?.bones).toBe(28)
    expect(done.rig?.boneNames).toEqual(['Hips', 'Spine'])
    expect(done.rootMotion).toEqual([
      [0, 0],
      [0.1, 0],
    ])
    expect(stage.disposed).toBe(1)
  })

  it('主体是纯黑时当场失败 —— 覆盖率那道闸拦不住它', async () => {
    // 贴图还没传上 GPU 就渲的话,模型是个纯黑剪影,而它的 alpha 占比与正常帧
    // **一模一样**(线上实测 0.101 对 0.101)—— 只数 alpha 的闸放它过去。
    stage.luma = 0
    const uploaded: number[] = []
    let failed = ''
    const apis = stubRender3DApis({
      putBakeFrame: async (_t, index) => {
        uploaded.push(index)
        return 1
      },
      completeBake: async () => expect.unreachable('纯黑帧却报了交齐'),
      failBake: async (_t, reason) => {
        failed = reason
      },
    })
    await expect(runClientBake({ job: bakeJob(), apis })).rejects.toThrow('纯黑')
    expect(uploaded).toEqual([])
    expect(failed).toContain('纯黑')
  })

  it('覆盖率不足当场失败,并且不把那一帧传上去', async () => {
    // 角色出画 / 片段选错都会安静地产出全透明帧,而外面照样以为成功了。
    stage.coverage = 0.0001
    const uploaded: number[] = []
    let failed = ''
    const apis = stubRender3DApis({
      putBakeFrame: async (_t, index) => {
        uploaded.push(index)
        return 1
      },
      completeBake: async () => expect.unreachable('全透明帧却报了交齐'),
      failBake: async (_t, reason) => {
        failed = reason
      },
    })
    await expect(runClientBake({ job: bakeJob(), apis })).rejects.toThrow('几乎全透明')
    expect(uploaded).toEqual([])
    expect(failed).toContain('几乎全透明')
  })

  it('模型里没有要的片段时报出实际有哪些', async () => {
    stage.clips = { idle: 10.0333, run: 0.7333 }
    let failed = ''
    const apis = stubRender3DApis({
      failBake: async (_t, reason) => {
        failed = reason
      },
    })
    await expect(runClientBake({ job: bakeJob({ clip: 'walk' }), apis })).rejects.toThrow(
      /没有片段/,
    )
    expect(failed).toContain('idle')
  })

  it('片段名是绑骨任务哈希、对不上动作名时,用模型里唯一那一个', async () => {
    // 拦的坏例:片段名由绑骨接口的动作库自己起(实测两次任务拿到的都是
    // `Armature|32795ddb244644eac67ccfd8b84060c3_remap`),永远等不上产品动作名 'walk'。
    // 按名字硬匹配的话**每一份真实绑骨产物**都会被判成"模型里没有片段 walk",
    // 三渲二一帧都出不来 —— 而这条报错听上去像模型坏了。
    const HASHED = 'Armature|32795ddb244644eac67ccfd8b84060c3_remap'
    stage.clips = { [HASHED]: 1.0667 }
    let completed: { clip: string; sampleTimes: number[] } | null = null
    const apis = stubRender3DApis({
      completeBake: async (_taskId, completion) => {
        completed = completion
      },
    })
    await runClientBake({ job: bakeJob({ frames: 2 }), apis })

    expect(stage.setups.map(([clip]) => clip)).toEqual([HASHED, HASHED])
    // 交回的仍是**登记的那个名字** —— 后端按它对账,换成真实片段名会被判成交错了片段。
    expect(completed).toMatchObject({ clip: 'walk', sampleTimes: [0, 0.1] })
  })

  it('一个片段都没有时说清是绑骨没带动作', async () => {
    stage.clips = {}
    await expect(runClientBake({ job: bakeJob(), apis: stubRender3DApis() })).rejects.toThrow(
      /没有任何动画片段/,
    )
  })

  it('任何失败都主动上报 —— 否则那笔冻结的积分要等满期限才解冻', async () => {
    stage.grabError = new Error('WebGL 上下文丢失')
    let failed: string | null = null
    const apis = stubRender3DApis({
      failBake: async (_t, reason) => {
        failed = reason
      },
    })
    await expect(runClientBake({ job: bakeJob(), apis })).rejects.toThrow('WebGL 上下文丢失')
    expect(failed).toBe('WebGL 上下文丢失')
  })

  it('取消不上报失败 —— 那是用户自己的动作,任务留给期限兜底', async () => {
    const controller = new AbortController()
    controller.abort()
    let failCalled = false
    const apis = stubRender3DApis({
      failBake: async () => {
        failCalled = true
      },
    })
    await expect(
      runClientBake({ job: bakeJob(), apis, signal: controller.signal }),
    ).rejects.toBeInstanceOf(BakeAborted)
    expect(failCalled).toBe(false)
  })

  it('上报失败本身失败时,不掩盖原来的错', async () => {
    stage.grabError = new Error('原始故障')
    const apis = stubRender3DApis({
      failBake: async () => {
        throw new Error('网络也断了')
      },
    })
    await expect(runClientBake({ job: bakeJob(), apis })).rejects.toThrow('原始故障')
  })

  it('无论成败都释放 WebGL 上下文 —— 浏览器对同时存在的上下文有硬上限', async () => {
    stage.grabError = new Error('炸了')
    await expect(runClientBake({ job: bakeJob(), apis: stubRender3DApis() })).rejects.toThrow()
    expect(stage.disposed).toBe(1)
  })

  it('模型加载失败照样上报,不当成"没这回事"', async () => {
    // 上下文有没有真的释放在这里测不到(jsdom 没有 WebGL,桩里 dispose 是我自己调的)。
    // 这条只钉运行时行为:建台失败要抛出去、要报给后端,不能把任务悬着。
    stage.createError = new Error('Bad glTF')
    let failed = ''
    const apis = stubRender3DApis({
      failBake: async (_taskId, reason) => {
        failed = reason
      },
    })
    await expect(runClientBake({ job: bakeJob(), apis })).rejects.toThrow('Bad glTF')
    expect(failed).toBe('Bad glTF')
    expect(stage.createdContexts).toBe(1)
  })

  it('逐帧回报进度', async () => {
    const seen: number[] = []
    await runClientBake({
      job: bakeJob({ frames: 3 }),
      apis: stubRender3DApis(),
      onProgress: ({ done, total }) => {
        expect(total).toBe(3)
        seen.push(done)
      },
    })
    expect(seen).toEqual([1, 2, 3])
  })
})
