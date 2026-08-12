/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExportPackageModel } from './model'
import { ExportButton, ExportPanel } from './export-panel'

const model = {
  stage: 'action-assets',
  characterId: 'character-1',
  characterName: 'Aster',
  characterImageUrl: '/master.png',
  outfitId: 'outfit-1',
  outfitName: 'Explorer',
  canvas: { width: 32, height: 40 },
  source: { workflowRunId: 'run-1', generationIds: ['generation-1'] },
  firstFrames: [
    { actionId: 'walk-abcdef12', name: 'Walk', type: 'walk', fps: 10, imageUrl: '/walk.png' },
  ],
  actions: [
    {
      id: 'walk-abcdef12',
      name: 'Walk',
      type: 'walk',
      fps: 10,
      sequences: [
        {
          direction: 'south',
          expectedFrameCount: 1,
          loop: true,
          anchor: { x: 0.5, y: 0.9 },
          footY: 36,
          qualityStatus: 'passed',
          frames: [
            {
              index: 0,
              imageUrl: '/walk.png',
              durationMs: 100,
            },
          ],
        },
      ],
    },
  ],
  playtest: null,
} satisfies ExportPackageModel

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ExportPanel', () => {
  it('质量问题会阻止导出，而不是只显示警告', () => {
    render(<ExportPanel model={model} qualityIssueCount={3} />)

    expect(screen.getByText('当前有 3 项质量问题，全部通过后才能导出')).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: '导出游戏资产包',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('显示进度、阻止重复点击、下载后释放临时地址', async () => {
    let resolveExport: (value: { blob: Blob; filename: string }) => void = () => {
      throw new Error('export promise was not initialized')
    }
    const exporter = vi.fn(
      (
        _model: ExportPackageModel,
        onPhase?: (phase: 'validating' | 'collecting' | 'rendering' | 'packing') => void,
      ) => {
        onPhase?.('rendering')
        return new Promise<{ blob: Blob; filename: string }>((resolve) => {
          resolveExport = resolve
        })
      },
    )
    const createObjectURL = vi.fn(() => 'blob:asset-package')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<ExportPanel model={model} exporter={exporter} />)
    const button = screen.getByRole('button', { name: '导出游戏资产包' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(screen.getByText('正在生成图片')).toBeTruthy()
    expect(exporter).toHaveBeenCalledTimes(1)

    resolveExport({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'windup-Aster-character-1.zip',
    })
    await waitFor(() => expect(screen.getByText('下载完成')).toBeTruthy())
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:asset-package')
    click.mockRestore()
  })

  it('展示具体错误字段，并允许修复后重试', async () => {
    const exporter = vi
      .fn()
      .mockRejectedValueOnce(new Error('actions[0].frames: 缺帧'))
      .mockResolvedValueOnce({
        blob: new Blob(['zip'], { type: 'application/zip' }),
        filename: 'windup-Aster-character-1.zip',
      })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:retry'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<ExportPanel model={model} exporter={exporter} />)
    fireEvent.click(screen.getByRole('button', { name: '导出游戏资产包' }))
    await waitFor(() => expect(screen.getByText('导出失败：actions[0].frames: 缺帧')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '重新导出' }))
    await waitFor(() => expect(screen.getByText('下载完成')).toBeTruthy())
    expect(exporter).toHaveBeenCalledTimes(2)
  })

  it('只有角色母版、还没有动作时也允许导出基础包', async () => {
    const exporter = vi.fn().mockResolvedValue({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'windup-character.zip',
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:character'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(
      <ExportPanel
        model={{ ...model, stage: 'character', firstFrames: [], actions: [] }}
        exporter={exporter}
      />,
    )

    expect(screen.getByText('当前包含角色母版')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导出游戏资产包' }))
    await waitFor(() => expect(exporter).toHaveBeenCalledTimes(1))
  })

  it('导出器抛出非 Error 值时展示通用错误', async () => {
    const exporter = vi.fn().mockRejectedValue('network unavailable')

    render(<ExportPanel model={model} exporter={exporter} />)
    fireEvent.click(screen.getByRole('button', { name: '导出游戏资产包' }))

    await waitFor(() => expect(screen.getByText('导出失败：未知错误')).toBeTruthy())
  })

  it('紧凑导出按钮完成下载后显示成功状态', async () => {
    const exporter = vi.fn().mockResolvedValue({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'windup-character.zip',
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:compact-export'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<ExportButton model={model} exporter={exporter} />)
    fireEvent.click(screen.getByRole('button', { name: '导出完整动作资产' }))

    expect(await screen.findByRole('button', { name: '下载完成' })).toBeTruthy()
  })
})
