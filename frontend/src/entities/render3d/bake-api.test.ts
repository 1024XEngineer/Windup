import { describe, expect, it, vi } from 'vitest'

import type { ApiClient } from '@/shared/api'
import { createRender3DApis, Render3DContractError } from './api'

const JOB = {
  task_id: 41,
  model_url: 'https://cdn.test/media/model-3d/rigged.glb',
  clip: 'walk',
  direction: 'e',
  camera_yaw: 0,
  frames: 8,
  width: 1536,
  height: 2560,
  material: 'cel',
  min_coverage: 0.005,
  deadline_at: 4_102_444_800,
  received: 0,
}

function client(handler: (path: string, options?: Record<string, unknown>) => unknown): {
  api: ApiClient
  calls: Array<{ path: string; method: string; body?: unknown; json?: unknown }>
} {
  const calls: Array<{ path: string; method: string; body?: unknown; json?: unknown }> = []
  const api: ApiClient = {
    request: vi.fn(async (path: string, options?: Record<string, unknown>) => {
      calls.push({
        path,
        method: (options?.method as string) ?? 'GET',
        body: options?.body,
        json: options?.json,
      })
      return handler(path, options)
    }) as ApiClient['request'],
    requestList: vi.fn() as ApiClient['requestList'],
  }
  return { api, calls }
}

describe('出帧任务的网络边界', () => {
  it('把后端的 snake_case 转成前端形状', async () => {
    const { api } = client(() => JOB)
    const job = await createRender3DApis(api).getBakeJob(41)
    expect(job).toEqual({
      taskId: 41,
      modelUrl: JOB.model_url,
      clip: 'walk',
      direction: 'e',
      cameraYaw: 0,
      frames: 8,
      width: 1536,
      height: 2560,
      material: 'cel',
      minCoverage: 0.005,
      deadlineAt: JOB.deadline_at,
      received: 0,
    })
  })

  it('没有登记是正常结果,返回 null 而不是抛', async () => {
    const { api } = client(() => {
      throw new Error('404')
    })
    await expect(createRender3DApis(api).getBakeJob(41)).resolves.toBeNull()
  })

  it('材质认不出当场抛 —— 否则要等模型下完、渲到一半才发现', async () => {
    const { api } = client(() => ({ ...JOB, material: 'studio' }))
    await expect(createRender3DApis(api).getBakeJob(41)).rejects.toBeInstanceOf(
      Render3DContractError,
    )
  })

  it('缺字段当契约错处理,不给默认值', async () => {
    const { api } = client(() => {
      const { min_coverage: _dropped, ...rest } = JOB
      return rest
    })
    await expect(createRender3DApis(api).getBakeJob(41)).rejects.toBeInstanceOf(
      Render3DContractError,
    )
  })

  it('交帧走 multipart,不手动设 Content-Type', async () => {
    const { api, calls } = client(() => ({ task_id: 41, index: 0, received: 1 }))
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    const received = await createRender3DApis(api).putBakeFrame(41, 0, png)
    expect(received).toBe(1)
    expect(calls[0].path).toBe('/render3d/bake/41/frames/0')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toBeInstanceOf(FormData)
  })

  it('报交齐带上片段名与采样时刻', async () => {
    const { api, calls } = client(() => ({}))
    await createRender3DApis(api).completeBake(41, { clip: 'walk', sampleTimes: [0, 0.5] })
    expect(calls[0].path).toBe('/render3d/bake/41/complete')
    // rig / root_motion 缺省时显式发 null，而不是省略字段 —— 后端据此区分
    // 「这条路没有骨架」与「字段忘了传」。
    expect(calls[0].json).toEqual({
      clip: 'walk',
      sample_times: [0, 0.5],
      rig: null,
      root_motion: null,
    })
  })

  it('报失败带上原因', async () => {
    const { api, calls } = client(() => ({}))
    await createRender3DApis(api).failBake(41, 'WebGL 起不来')
    expect(calls[0].path).toBe('/render3d/bake/41/fail')
    expect(calls[0].json).toEqual({ reason: 'WebGL 起不来' })
  })
})

describe('建 3D 资产的体型入参', () => {
  it('把 stance 放进请求体 —— 后端必填，前端不能省', async () => {
    const { api, calls } = client(() => ({
      state: 'building',
      model_3d_url: null,
      review_model_url: null,
      error: null,
      cost: {
        model3d_credits: 20,
        autorig_credits: 10,
        total_credits: 30,
        billing: 'postpaid',
        scope: 'per_outfit_once',
      },
    }))
    await createRender3DApis(api).buildOutfitAsset('7', 'outfit-default', 'quadruped')
    expect(calls[0].path).toBe('/render3d/characters/7/outfits/outfit-default/build')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].json).toEqual({ stance: 'quadruped' })
  })
})
