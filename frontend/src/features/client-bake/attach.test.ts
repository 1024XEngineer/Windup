import { describe, expect, it, vi } from 'vitest'

import { bakeJob, stubRender3DApis } from '@/test/render3d-apis'
import { attachClientBake } from './attach'

vi.mock('./stage', async () => {
  const actual = await vi.importActual<typeof import('./stage')>('./stage')
  return {
    ...actual,
    BakeStage: {
      create: vi.fn(async () => ({
        availableClips: () => ({ walk: 1.0667 }),
        setCamYaw: () => undefined,
        setup: (_clip: string, i: number) => i * 0.1,
        coverage: () => 0.01,
        subjectLuma: () => 148,
        rigInfo: () => ({
          loader: 'gltf',
          rootBone: 'Hips',
          bones: 28,
          boneNames: ['Hips'],
          skinned: 1,
          verts: 100,
          orthoH: 5.95,
          material: 'cel',
        }),
        rootMotionOf: () => [],
        grab: async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]),
        dispose: () => undefined,
      })),
    },
  }
})

const noSleep = async () => undefined

describe('把出帧接到任务订阅上', () => {
  it('登记还没写好时重试,写好了就开渲', async () => {
    // 建单与登记之间隔着一次 MQ 投递,第一次问多半问不到。
    let asked = 0
    const apis = stubRender3DApis({
      getBakeJob: async () => {
        asked += 1
        return asked < 3 ? null : bakeJob({ frames: 2 })
      },
    })
    await expect(attachClientBake(41, { apis, sleep: noSleep })).resolves.toBe(true)
    expect(asked).toBe(3)
  })

  it('一直问不到就是这条任务走 i2v,收手不报错', async () => {
    const apis = stubRender3DApis({ getBakeJob: async () => null })
    await expect(attachClientBake(41, { apis, sleep: noSleep })).resolves.toBe(false)
  })

  it('重试次数有上限,不会一直问下去', async () => {
    let asked = 0
    const apis = stubRender3DApis({
      getBakeJob: async () => {
        asked += 1
        return null
      },
    })
    await attachClientBake(41, { apis, sleep: noSleep })
    expect(asked).toBeLessThanOrEqual(6)
  })

  it('渲完把帧交上去', async () => {
    const uploaded: number[] = []
    let completed = false
    const apis = stubRender3DApis({
      getBakeJob: async () => bakeJob({ frames: 2 }),
      putBakeFrame: async (_taskId, index) => {
        uploaded.push(index)
        return uploaded.length
      },
      completeBake: async () => {
        completed = true
      },
    })
    await attachClientBake(41, { apis, sleep: noSleep })
    expect(uploaded).toEqual([0, 1])
    expect(completed).toBe(true)
  })
})
