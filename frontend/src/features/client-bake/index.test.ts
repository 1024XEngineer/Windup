import { beforeEach, describe, expect, it, vi } from 'vitest'

import { bakeJob, stubRender3DApis } from '@/test/render3d-apis'

const stage = vi.hoisted(() => ({
  clips: { walk: 1.0667 } as Record<string, number>,
  coverage: 0.01,
  setups: [] as Array<[string, number, number]>,
  yaw: null as number | null,
  disposed: 0,
  grabError: null as Error | null,
}))

vi.mock('./stage', async () => {
  const actual = await vi.importActual<typeof import('./stage')>('./stage')
  return {
    ...actual,
    BakeStage: {
      create: vi.fn(async () => ({
        availableClips: () => stage.clips,
        setCamYaw: (deg: number) => {
          stage.yaw = deg
        },
        setup: (clip: string, i: number, n: number) => {
          stage.setups.push([clip, i, n])
          return i * 0.1
        },
        coverage: () => stage.coverage,
        grab: async () => {
          if (stage.grabError) throw stage.grabError
          return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
        },
        dispose: () => {
          stage.disposed++
        },
      })),
    },
  }
})

const { runClientBake, BakeAborted } = await import('.')

beforeEach(() => {
  stage.clips = { walk: 1.0667 }
  stage.coverage = 0.01
  stage.setups = []
  stage.yaw = null
  stage.disposed = 0
  stage.grabError = null
})

describe('浏览器出帧驱动', () => {
  it('按 plan 的朝向与帧数逐帧交付,最后报交齐', async () => {
    const uploaded: number[] = []
    let completed: { clip: string; sampleTimes: number[] } | null = null
    const apis = stubRender3DApis({
      putBakeFrame: async (_taskId, index) => {
        uploaded.push(index)
        return uploaded.length
      },
      completeBake: async (_taskId, completion) => {
        completed = completion
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
    expect(completed).toEqual({ clip: 'walk', sampleTimes: [0, 0.1, 0.2] })
    expect(stage.disposed).toBe(1)
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
