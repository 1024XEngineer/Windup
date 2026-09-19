/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExportPackageModel } from './model'

const { exportGameAssetsMock, importIntoCocosMock, pairMock } = vi.hoisted(() => ({
  exportGameAssetsMock: vi.fn(),
  importIntoCocosMock: vi.fn(),
  pairMock: vi.fn(),
}))

vi.mock('./asset-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./asset-export')>()
  return { ...actual, exportGameAssets: exportGameAssetsMock }
})

vi.mock('./cocos-one-click', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cocos-one-click')>()
  return { ...actual, importIntoCocos: importIntoCocosMock }
})

vi.mock('./cocos-bridge-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cocos-bridge-client')>()
  return {
    ...actual,
    CocosBridgeClient: class {
      pair(code: string) {
        return pairMock(code)
      }
    },
  }
})

import { CocosBridgeError } from './cocos-bridge-client'
import { ExportPanel } from './export-panel'

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

const importResult = {
  projectName: 'DefaultGame',
  dbUrl: 'db://assets/windup-imports/Hero.prefab',
  animationCount: 0,
  frameCount: 0,
}

beforeEach(() => {
  exportGameAssetsMock.mockReset()
  importIntoCocosMock.mockReset()
  pairMock.mockReset()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:cocos-default'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ExportPanel Cocos defaults', () => {
  it('uses the default Cocos package exporter for the download fallback', async () => {
    exportGameAssetsMock.mockResolvedValue({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'windup-cocos.zip',
    })

    render(<ExportPanel model={model} />)
    fireEvent.click(screen.getByRole('button', { name: '下载 Cocos 包' }))

    await waitFor(() => expect(exportGameAssetsMock).toHaveBeenCalledTimes(1))
    const options = exportGameAssetsMock.mock.calls[0]?.[1] as {
      targets: Array<{ id: string }>
    }
    expect(options.targets.map((target) => target.id)).toEqual(['cocos-creator'])
  })

  it('uses the default bridge importer when no importer is injected', async () => {
    importIntoCocosMock.mockResolvedValue(importResult)

    render(<ExportPanel model={model} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))

    expect(await screen.findByText('已导入到当前 Cocos 工程')).toBeTruthy()
    expect(importIntoCocosMock).toHaveBeenCalledWith(
      model,
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ cache: {} }),
    )
  })

  it('uses the default bridge pairer before retrying the import', async () => {
    importIntoCocosMock
      .mockRejectedValueOnce(new CocosBridgeError('PAIRING_REQUIRED', '请先配对'))
      .mockResolvedValueOnce(importResult)
    pairMock.mockResolvedValue(undefined)

    render(<ExportPanel model={model} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))
    fireEvent.change(await screen.findByLabelText('Creator 连接码'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: '连接并导入' }))

    await waitFor(() => expect(pairMock).toHaveBeenCalledWith('123456'))
    expect(await screen.findByText('已导入到当前 Cocos 工程')).toBeTruthy()
    expect(importIntoCocosMock).toHaveBeenCalledTimes(2)
  })
})
