import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssetExportResult } from './asset-export'
import type { CocosBridgeApi, CocosOneClickPhase } from './cocos-one-click'
import { importIntoCocos } from './cocos-one-click'
import type { ExportPackageModel } from './model'

const { exportGameAssetsMock } = vi.hoisted(() => ({ exportGameAssetsMock: vi.fn() }))

vi.mock('./asset-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./asset-export')>()
  return { ...actual, exportGameAssets: exportGameAssetsMock }
})

const model: ExportPackageModel = {
  stage: 'character',
  characterId: 'hero',
  characterName: 'Hero',
  characterImageUrl: 'memory://hero.png',
  outfitId: 'default',
  outfitName: 'Default',
  canvas: { width: 256, height: 256 },
  source: null,
  firstFrames: [],
  actions: [],
  playtest: null,
}

const packageResult: AssetExportResult = {
  blob: new Blob(['zip'], { type: 'application/zip' }),
  filename: 'windup-Hero.zip',
}

const bridge: CocosBridgeApi = {
  health: async () => ({
    protocol: 'windup-cocos-bridge/1.0.0',
    creatorVersion: '3.8.8',
    projectName: 'Game',
    projectOpen: true,
    paired: true,
  }),
  submit: async () => ({ jobId: 'job-default-exporter' }),
  getJob: async () => ({
    protocol: 'windup-cocos-bridge/1.0.0',
    jobId: 'job-default-exporter',
    status: 'completed',
    phase: 'verifying',
    result: {
      projectName: 'Game',
      dbUrl: 'db://assets/windup-imports/Hero.prefab',
      animationCount: 0,
      frameCount: 0,
    },
  }),
}

beforeEach(() => {
  exportGameAssetsMock.mockReset()
  exportGameAssetsMock.mockImplementation(
    async (_model: ExportPackageModel, options: { onPhase?: (phase: 'packing') => void }) => {
      options.onPhase?.('packing')
      return packageResult
    },
  )
})

describe('importIntoCocos defaults', () => {
  it('uses the Cocos target when no custom package exporter is supplied', async () => {
    const phases: CocosOneClickPhase[] = []

    await importIntoCocos(model, bridge, (phase) => phases.push(phase), {
      pollDelay: async () => undefined,
      createRequestId: () => '11111111-1111-4111-8111-111111111111',
    })

    expect(exportGameAssetsMock).toHaveBeenCalledTimes(1)
    const options = exportGameAssetsMock.mock.calls[0]?.[1] as {
      targets: Array<{ id: string }>
    }
    expect(options.targets.map((target) => target.id)).toEqual(['cocos-creator'])
    expect(phases).toEqual(['detecting', 'packing', 'uploading', 'verifying'])
  })
})
