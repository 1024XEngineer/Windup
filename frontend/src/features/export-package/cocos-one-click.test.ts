import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssetExportResult } from './asset-export'
import type { CocosBridgeApi, CocosImportCache, CocosOneClickPhase } from './cocos-one-click'
import { importIntoCocos } from './cocos-one-click'
import { CocosBridgeError, type CocosImportJob } from './cocos-bridge-client'
import type { ExportPackageModel } from './model'

function model(): ExportPackageModel {
  return {
    stage: 'action-assets',
    characterId: 'hero',
    characterName: 'Hero',
    characterImageUrl: 'memory://hero.png',
    outfitId: 'default',
    outfitName: 'Ranger',
    canvas: { width: 256, height: 256 },
    source: null,
    firstFrames: [],
    playtest: null,
    actions: [],
  }
}

function completedJob(): CocosImportJob {
  return {
    protocol: 'windup-cocos-bridge/1.0.0',
    jobId: 'job-1',
    status: 'completed',
    phase: 'verifying',
    result: {
      projectName: 'Game',
      dbUrl: 'db://assets/windup-imports/Hero/Ranger/prefabs/Hero-Ranger.prefab',
      animationCount: 2,
      frameCount: 64,
    },
  }
}

function bridge(overrides: Partial<CocosBridgeApi> = {}): CocosBridgeApi {
  return {
    health: async () => ({
      protocol: 'windup-cocos-bridge/1.0.0',
      creatorVersion: '3.8.8',
      projectName: 'Game',
      projectOpen: true,
      paired: true,
    }),
    submit: async () => ({ jobId: 'job-1' }),
    getJob: async () => completedJob(),
    ...overrides,
  }
}

const packageResult: AssetExportResult = {
  blob: new Blob(['zip'], { type: 'application/zip' }),
  filename: 'windup-Hero.zip',
}

afterEach(() => {
  vi.useRealTimers()
})

describe('importIntoCocos', () => {
  it('checks Creator, exports once, uploads and returns the completed result', async () => {
    const phases: CocosOneClickPhase[] = []
    let exportCount = 0
    const result = await importIntoCocos(model(), bridge(), (phase) => phases.push(phase), {
      exporter: async (_model, onPhase) => {
        exportCount += 1
        onPhase?.('validating')
        onPhase?.('rendering')
        onPhase?.('packing')
        return packageResult
      },
      createRequestId: () => '11111111-1111-4111-8111-111111111111',
      pollDelay: async () => undefined,
    })

    expect(exportCount).toBe(1)
    expect(result.animationCount).toBe(2)
    expect(result.frameCount).toBe(64)
    expect(phases).toEqual([
      'detecting',
      'validating',
      'packing',
      'packing',
      'uploading',
      'verifying',
    ])
  })

  it('reuses the prepared ZIP when a network retry uses the same model and cache', async () => {
    const currentModel = model()
    const cache: CocosImportCache = {}
    let exportCount = 0
    let submitCount = 0
    const api = bridge({
      submit: async () => {
        submitCount += 1
        if (submitCount === 1) throw new CocosBridgeError('PLUGIN_UNAVAILABLE', '暂时断开')
        return { jobId: 'job-1' }
      },
    })
    const options = {
      cache,
      exporter: async () => {
        exportCount += 1
        return packageResult
      },
      createRequestId: () => '11111111-1111-4111-8111-111111111111',
      pollDelay: async () => undefined,
    }

    await expect(importIntoCocos(currentModel, api, () => undefined, options)).rejects.toThrow(
      '暂时断开',
    )
    await importIntoCocos(currentModel, api, () => undefined, options)

    expect(exportCount).toBe(1)
    expect(submitCount).toBe(2)
  })

  it('stops before exporting when Creator has no open project', async () => {
    let exported = false
    const api = bridge({
      health: async () => ({
        protocol: 'windup-cocos-bridge/1.0.0',
        creatorVersion: '3.8.8',
        projectName: null,
        projectOpen: false,
        paired: true,
      }),
    })

    await expect(
      importIntoCocos(model(), api, () => undefined, {
        exporter: async () => {
          exported = true
          return packageResult
        },
      }),
    ).rejects.toThrow('请先在 Cocos Creator 中打开目标工程')
    expect(exported).toBe(false)
  })

  it('asks for pairing before exporting when the plugin is unpaired', async () => {
    const api = bridge({
      health: async () => ({
        protocol: 'windup-cocos-bridge/1.0.0',
        creatorVersion: '3.8.8',
        projectName: 'Game',
        projectOpen: true,
        paired: false,
      }),
    })

    await expect(importIntoCocos(model(), api)).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' })
  })

  it.each(['3.8.7', '3.9.0', 'invalid'])(
    'rejects unsupported Creator version %s before exporting',
    async (creatorVersion) => {
      let exported = false
      await expect(
        importIntoCocos(
          model(),
          bridge({
            health: async () => ({
              protocol: 'windup-cocos-bridge/1.0.0',
              creatorVersion,
              projectName: 'Game',
              projectOpen: true,
              paired: true,
            }),
          }),
          () => undefined,
          {
            exporter: async () => {
              exported = true
              return packageResult
            },
          },
        ),
      ).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' })
      expect(exported).toBe(false)
    },
  )

  it('accepts the newest supported Creator 3.8 patch release', async () => {
    await expect(
      importIntoCocos(
        model(),
        bridge({
          health: async () => ({
            protocol: 'windup-cocos-bridge/1.0.0',
            creatorVersion: '3.8.99',
            projectName: 'Game',
            projectOpen: true,
            paired: true,
          }),
        }),
        () => undefined,
        {
          exporter: async () => packageResult,
          pollDelay: async () => undefined,
        },
      ),
    ).resolves.toMatchObject({ projectName: 'Game' })
  })

  it('accepts a supported Creator prerelease suffix', async () => {
    await expect(
      importIntoCocos(
        model(),
        bridge({
          health: async () => ({
            protocol: 'windup-cocos-bridge/1.0.0',
            creatorVersion: '3.8.8-beta.1',
            projectName: 'Game',
            projectOpen: true,
            paired: true,
          }),
        }),
        () => undefined,
        { exporter: async () => packageResult, pollDelay: async () => undefined },
      ),
    ).resolves.toMatchObject({ projectName: 'Game' })
  })

  it.each([null, '4.8.8', '3.7.8'])('rejects incompatible Creator version %s', async (version) => {
    await expect(
      importIntoCocos(
        model(),
        bridge({
          health: async () => ({
            protocol: 'windup-cocos-bridge/1.0.0',
            creatorVersion: version,
            projectName: 'Game',
            projectOpen: true,
            paired: true,
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' })
  })

  it('reports every plugin phase while a job advances', async () => {
    const phases: CocosOneClickPhase[] = []
    const pendingPhases = ['queued', 'validating', 'converting', 'writing', 'refreshing'] as const
    let call = 0
    const api = bridge({
      getJob: async () => {
        const phase = pendingPhases[call]
        call += 1
        if (phase === undefined) return completedJob()
        return {
          protocol: 'windup-cocos-bridge/1.0.0',
          jobId: 'job-1',
          status: phase === 'queued' ? 'queued' : 'running',
          phase,
        }
      },
    })

    await importIntoCocos(model(), api, (phase) => phases.push(phase), {
      exporter: async () => packageResult,
      pollDelay: async () => undefined,
    })

    expect(phases).toEqual([
      'detecting',
      'uploading',
      'queued',
      'validating',
      'converting',
      'writing',
      'refreshing',
      'verifying',
    ])
  })

  it('rejects a completed job that omits its import result', async () => {
    const completedWithoutResult = completedJob()
    delete completedWithoutResult.result

    await expect(
      importIntoCocos(
        model(),
        bridge({ getJob: async () => completedWithoutResult }),
        () => undefined,
        { exporter: async () => packageResult, pollDelay: async () => undefined },
      ),
    ).rejects.toThrow('Creator 插件未返回导入结果')
  })

  it('uses stable failure details when a failed job omits its error payload', async () => {
    const failedWithoutError = completedJob()
    failedWithoutError.status = 'failed'
    failedWithoutError.phase = 'converting'
    delete failedWithoutError.result

    await expect(
      importIntoCocos(
        model(),
        bridge({ getJob: async () => failedWithoutError }),
        () => undefined,
        { exporter: async () => packageResult, pollDelay: async () => undefined },
      ),
    ).rejects.toMatchObject({
      message: 'Cocos 导入失败',
      jobCode: 'IMPORT_FAILED',
      phase: 'converting',
      rolledBack: false,
    })
  })

  it('uses the default polling delay when no custom delay is supplied', async () => {
    vi.useFakeTimers()
    const running = completedJob()
    running.status = 'running'
    running.phase = 'queued'
    delete running.result

    const promise = importIntoCocos(
      model(),
      bridge({ getJob: async () => running }),
      () => undefined,
      { exporter: async () => packageResult, maxPolls: 1 },
    )
    const rejection = expect(promise).rejects.toThrow('等待 Cocos 导入完成超时')
    await vi.advanceTimersByTimeAsync(500)

    await rejection
  })

  it('reports the plugin failure and whether the previous asset was restored', async () => {
    const failed = completedJob()
    failed.status = 'failed'
    failed.error = {
      code: 'IMPORT_UUID_UNRESOLVED',
      message: 'Prefab 引用不存在',
      rolledBack: true,
    }
    delete failed.result

    const promise = importIntoCocos(
      model(),
      bridge({ getJob: async () => failed }),
      () => undefined,
      {
        exporter: async () => packageResult,
        pollDelay: async () => undefined,
      },
    )
    await expect(promise).rejects.toThrow('Prefab 引用不存在（已回滚本次写入）')
    await expect(promise).rejects.toMatchObject({
      jobCode: 'IMPORT_UUID_UNRESOLVED',
      phase: 'verifying',
      rolledBack: true,
    })
  })

  it('preserves a rollback failure as an actionable import error', async () => {
    const failed = completedJob()
    failed.status = 'failed'
    failed.phase = 'writing'
    failed.error = {
      code: 'IMPORT_ROLLBACK_FAILED',
      message: '导入失败且无法完整回滚，请检查工程资产',
      rolledBack: false,
    }
    delete failed.result

    await expect(
      importIntoCocos(model(), bridge({ getJob: async () => failed }), () => undefined, {
        exporter: async () => packageResult,
        pollDelay: async () => undefined,
      }),
    ).rejects.toMatchObject({
      jobCode: 'IMPORT_ROLLBACK_FAILED',
      phase: 'writing',
      rolledBack: false,
    })
  })

  it('fails instead of polling forever when the job never finishes', async () => {
    const running = completedJob()
    running.status = 'running'
    running.phase = 'writing'
    delete running.result

    await expect(
      importIntoCocos(model(), bridge({ getJob: async () => running }), () => undefined, {
        exporter: async () => packageResult,
        pollDelay: async () => undefined,
        maxPolls: 2,
      }),
    ).rejects.toThrow('等待 Cocos 导入完成超时')
  })
})
