/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExportPackageModel } from './model'
import { AssetVersionExportButton, ExportButton, ExportPanel } from './export-panel'

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

  it('紧凑导出按钮失败后显示可访问的具体错误', async () => {
    const exporter = vi.fn().mockRejectedValue(new Error('图片下载失败'))

    const { container } = render(<ExportButton model={model} exporter={exporter} />)
    fireEvent.click(screen.getByRole('button', { name: '导出完整动作资产' }))

    const alert = await screen.findByRole('alert')
    const retryButton = screen.getByRole('button', { name: '重新导出' })
    expect(container.firstElementChild?.className).toContain('grid')
    expect(retryButton.contains(alert)).toBe(false)
    expect(alert.textContent).toBe('导出失败：图片下载失败')
  })

  it('紧凑导出按钮支持资产页的直接导出文案与胶囊形态', () => {
    render(<ExportButton model={model} idleLabel="导出资产包" pill />)

    const button = screen.getByRole('button', { name: '导出资产包' })
    expect(button.className).toContain('rounded-full')
  })

  it('紧凑导出按钮支持带 tooltip 的 SVG 图标形态', () => {
    render(<ExportButton model={model} iconOnly />)

    const button = screen.getByRole('button', { name: '导出完整动作资产' })
    expect(button.querySelector('svg')).toBeTruthy()
    expect(button.querySelector('[role="tooltip"]')?.textContent).toBe('导出完整动作资产')
  })

  it('有完美像素版时先选择下载版本，再导出命名清晰的单个资产包', async () => {
    const pixelPerfectModel = {
      ...model,
      actions: model.actions.map((action) => ({
        ...action,
        sequences: action.sequences.map((sequence) => ({
          ...sequence,
          frames: sequence.frames.map((frame) => ({
            ...frame,
            imageUrl: '/pixel-perfect-walk.png',
          })),
        })),
      })),
    } satisfies ExportPackageModel
    const exporter = vi.fn().mockResolvedValue({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'windup-Aster-character-1.zip',
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:versioned-export'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const downloads: string[] = []
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download)
      })

    render(
      <AssetVersionExportButton
        originalModel={model}
        pixelPerfectModel={pixelPerfectModel}
        exporter={exporter}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '选择下载版本' }))
    const menu = screen.getByRole('menu', { name: '选择下载版本' })
    expect(menu.className).toContain('rounded-app-surface')
    expect(screen.getByRole('menuitem', { name: /原始资产/u })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /完美像素版/u })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /全部下载/u })).toBeTruthy()
    expect(screen.queryByText('保留生成时的原始画面')).toBeNull()
    expect(screen.queryByText('使用像素网格重建结果')).toBeNull()
    expect(screen.queryByText('分别下载两套 ZIP 资产包')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: /完美像素版/u }))

    await waitFor(() =>
      expect(exporter).toHaveBeenCalledWith(pixelPerfectModel, expect.any(Function)),
    )
    expect(click).toHaveBeenCalledTimes(1)
    expect(downloads).toEqual(['windup-Aster-character-1-pixel-perfect.zip'])
    expect(screen.queryByRole('menu', { name: '选择下载版本' })).toBeNull()
  })

  it('全部下载会分别导出原始资产与完美像素版', async () => {
    const pixelPerfectModel = { ...model, characterImageUrl: '/pixel-perfect-master.png' }
    const exporter = vi.fn().mockResolvedValue({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'windup-Aster-character-1.zip',
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn().mockReturnValueOnce('blob:original').mockReturnValueOnce('blob:pixel-perfect'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        downloads.push(this.download)
      },
    )

    render(
      <AssetVersionExportButton
        originalModel={model}
        pixelPerfectModel={pixelPerfectModel}
        exporter={exporter}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '选择下载版本' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /全部下载/u }))

    await waitFor(() => expect(exporter).toHaveBeenCalledTimes(2))
    expect(exporter.mock.calls.map(([requestedModel]) => requestedModel)).toEqual([
      model,
      pixelPerfectModel,
    ])
    expect(downloads).toEqual([
      'windup-Aster-character-1-original.zip',
      'windup-Aster-character-1-pixel-perfect.zip',
    ])
  })

  it('下载版本菜单支持 Escape 关闭并把焦点还给下载按钮', async () => {
    render(<AssetVersionExportButton originalModel={model} pixelPerfectModel={model} />)

    const trigger = screen.getByRole('button', { name: '选择下载版本' })
    fireEvent.click(trigger)
    const original = screen.getByRole('menuitem', { name: /原始资产/u })
    await waitFor(() => expect(document.activeElement).toBe(original))

    fireEvent.keyDown(document, { key: 'Escape' })

    const closingMenu = screen.getByTestId('asset-version-menu')
    expect(closingMenu.getAttribute('data-state')).toBe('closing')
    expect(closingMenu.className).toContain('product-popover-out')
    expect(document.activeElement).toBe(trigger)
    fireEvent.animationEnd(closingMenu)
    await waitFor(() => expect(screen.queryByTestId('asset-version-menu')).toBeNull())
  })
})
