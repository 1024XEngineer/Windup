/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlaytestPreviewModel } from '../model/types'
import { ExportPanel } from './export-panel'

const model = {
  characterId: 'character-1',
  characterName: 'Aster',
  outfitId: 'outfit-1',
  outfitName: 'Explorer',
  characterTemplateUrl: null,
  baseFrameCount: 0,
  actions: [
    {
      id: 'walk-abcdef12',
      name: 'Walk',
      type: 'walk',
      fps: 10,
      sequences: [
        {
          direction: 'south',
          frames: [
            {
              imageUrl: '/walk.png',
              durationMs: 100,
              rootMotion: null,
              keyFrame: true,
            },
          ],
        },
      ],
    },
  ],
} satisfies PlaytestPreviewModel

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ExportPanel', () => {
  it('warns about current quality issues without blocking export', () => {
    render(<ExportPanel model={model} qualityIssueCount={3} />)

    expect(screen.getByText('当前核验存在 3 项质量问题，仍可导出')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '导出游戏资产包' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('shows progress, prevents duplicate export, downloads and revokes the object url', async () => {
    let resolveExport: (value: {
      blob: Blob
      filename: string
      incomplete: boolean
    }) => void = () => {
      throw new Error('export promise was not initialized')
    }
    const exporter = vi.fn(
      (
        _model: PlaytestPreviewModel,
        onPhase?: (phase: 'collecting' | 'rendering' | 'packing') => void,
      ) => {
        onPhase?.('rendering')
        return new Promise<{ blob: Blob; filename: string; incomplete: boolean }>((resolve) => {
          resolveExport = resolve
        })
      },
    )
    const createObjectURL = vi.fn(() => 'blob:asset-package')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<ExportPanel model={model} exporter={exporter} />)
    const button = screen.getByRole('button', { name: '导出游戏资产包' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(screen.getByText('正在生成图片')).toBeTruthy()
    expect(exporter).toHaveBeenCalledTimes(1)

    resolveExport({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'windup-Aster-Explorer.zip',
      incomplete: false,
    })
    await waitFor(() => expect(screen.getByText('下载完成')).toBeTruthy())
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:asset-package')
    click.mockRestore()
  })

  it('warns for incomplete packages and allows retry after failure', async () => {
    const exporter = vi
      .fn()
      .mockRejectedValueOnce(new Error('pack failed'))
      .mockResolvedValueOnce({
        blob: new Blob(['zip'], { type: 'application/zip' }),
        filename: 'windup-Aster-Explorer.zip',
        incomplete: true,
      })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:retry'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<ExportPanel model={model} exporter={exporter} />)
    fireEvent.click(screen.getByRole('button', { name: '导出游戏资产包' }))
    await waitFor(() => expect(screen.getByText('导出失败，可重试')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '重新导出' }))
    await waitFor(() => expect(screen.getByText('导出不完整，缺失图片已保留透明占位')).toBeTruthy())
    expect(exporter).toHaveBeenCalledTimes(2)
  })
})
