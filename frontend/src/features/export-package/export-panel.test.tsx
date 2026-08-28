/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExportPackageModel } from './model'
import { AssetVersionExportButton, ExportButton, ExportPanel } from './export-panel'
import { CocosBridgeError } from './cocos-bridge-client'

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
    expect(
      (screen.getByRole('button', { name: '一键导入 Cocos' }) as HTMLButtonElement).disabled,
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

  it('Cocos 下载降级按钮调用适配导出器并下载适配包', async () => {
    const exporter = vi.fn().mockResolvedValue({
      blob: new Blob(['cocos-zip'], { type: 'application/zip' }),
      filename: 'windup-cocos.zip',
    })
    const createObjectURL = vi.fn(() => 'blob:cocos')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<ExportPanel model={model} cocosExporter={exporter} />)
    fireEvent.click(screen.getByRole('button', { name: '下载 Cocos 包' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cocos 包下载完成' })).toBeTruthy(),
    )
    expect(exporter).toHaveBeenCalledWith(model, expect.any(Function))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cocos')
  })

  it('一键导入完成后显示当前工程和资产统计', async () => {
    const importer = vi
      .fn()
      .mockImplementation(
        async (_model: ExportPackageModel, onPhase: (phase: 'uploading' | 'verifying') => void) => {
          onPhase('uploading')
          onPhase('verifying')
          return {
            projectName: 'CocosGame',
            dbUrl: 'db://assets/windup-imports/Aster/Explorer/prefabs/Aster-Explorer.prefab',
            animationCount: 2,
            frameCount: 64,
          }
        },
      )

    render(<ExportPanel model={model} cocosImporter={importer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))

    expect(await screen.findByText('已导入到当前 Cocos 工程')).toBeTruthy()
    expect(screen.getByText('CocosGame · 2 个动作，64 帧')).toBeTruthy()
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('一键导入进行中时忽略绕过禁用属性的重复触发', async () => {
    let resolveImport: (result: {
      projectName: string
      dbUrl: string
      animationCount: number
      frameCount: number
    }) => void = () => {
      throw new Error('import promise was not initialized')
    }
    const importer = vi.fn(
      () =>
        new Promise<{
          projectName: string
          dbUrl: string
          animationCount: number
          frameCount: number
        }>((resolve) => {
          resolveImport = resolve
        }),
    )

    render(<ExportPanel model={model} cocosImporter={importer} />)
    const button = screen.getByRole('button', { name: '一键导入 Cocos' }) as HTMLButtonElement
    fireEvent.click(button)
    expect(button.disabled).toBe(true)

    button.disabled = false
    fireEvent.click(button)
    expect(importer).toHaveBeenCalledTimes(1)

    resolveImport({
      projectName: 'CocosGame',
      dbUrl: 'db://assets/windup-imports/Aster.prefab',
      animationCount: 1,
      frameCount: 8,
    })
    expect(await screen.findByText('已导入到当前 Cocos 工程')).toBeTruthy()
  })

  it('首次未配对时显示连接码输入框，配对后继续同一次导入', async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new CocosBridgeError('PAIRING_REQUIRED', '请先配对'))
      .mockResolvedValueOnce({
        projectName: 'Game',
        dbUrl: 'db://assets/windup-imports/Aster/Explorer/prefabs/Aster-Explorer.prefab',
        animationCount: 1,
        frameCount: 1,
      })
    const pairer = vi.fn().mockResolvedValue(undefined)

    render(<ExportPanel model={model} cocosImporter={importer} cocosPairer={pairer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))
    const input = await screen.findByLabelText('Creator 连接码')
    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '连接并导入' }))

    await waitFor(() => expect(pairer).toHaveBeenCalledWith('123456'))
    expect(await screen.findByText('已导入到当前 Cocos 工程')).toBeTruthy()
    expect(importer).toHaveBeenCalledTimes(2)
  })

  it('连接码不是六位数字时留在配对界面且不调用插件', async () => {
    const importer = vi.fn().mockRejectedValue(new CocosBridgeError('PAIRING_REQUIRED', '请先配对'))
    const pairer = vi.fn().mockResolvedValue(undefined)

    render(<ExportPanel model={model} cocosImporter={importer} cocosPairer={pairer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))
    const input = await screen.findByLabelText('Creator 连接码')
    fireEvent.change(input, { target: { value: '12a3' } })
    fireEvent.click(screen.getByRole('button', { name: '连接并导入' }))

    expect(await screen.findByText('请输入 Creator 显示的 6 位连接码')).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('123')
    expect(pairer).not.toHaveBeenCalled()
  })

  it('配对请求失败时显示插件返回的具体错误', async () => {
    const importer = vi.fn().mockRejectedValue(new CocosBridgeError('PAIRING_REQUIRED', '请先配对'))
    const pairer = vi.fn().mockRejectedValue(new Error('连接码已过期'))

    render(<ExportPanel model={model} cocosImporter={importer} cocosPairer={pairer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))
    fireEvent.change(await screen.findByLabelText('Creator 连接码'), {
      target: { value: '654321' },
    })
    fireEvent.click(screen.getByRole('button', { name: '连接并导入' }))

    expect(await screen.findByText('导入失败：连接码已过期')).toBeTruthy()
    expect(pairer).toHaveBeenCalledWith('654321')
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('插件不可用时保留明确错误和 Cocos 包下载降级入口', async () => {
    const importer = vi
      .fn()
      .mockRejectedValue(new CocosBridgeError('PLUGIN_UNAVAILABLE', '未检测到 Cocos Creator 插件'))

    render(<ExportPanel model={model} cocosImporter={importer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))

    expect(await screen.findByText('导入失败：未检测到 Cocos Creator 插件')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载 Cocos 包' })).toBeTruthy()
  })

  it('导入失败时显示阶段、稳定错误码和未回滚警告', async () => {
    const error = new CocosBridgeError('IMPORT_FAILED', '写入失败', undefined, {
      jobCode: 'IMPORT_ROLLBACK_FAILED',
      phase: 'writing',
      rolledBack: false,
    })
    const importer = vi.fn().mockRejectedValue(error)

    render(<ExportPanel model={model} cocosImporter={importer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))

    expect(await screen.findByText('导入失败：写入失败')).toBeTruthy()
    expect(screen.getByText(/错误码：IMPORT_ROLLBACK_FAILED/)).toBeTruthy()
    expect(screen.getByText(/回滚：未完成，请检查工程资产/)).toBeTruthy()
  })

  it('导入失败时区分已回滚和无需回滚', async () => {
    const rolledBack = new CocosBridgeError('IMPORT_FAILED', '资源刷新失败', undefined, {
      jobCode: 'IMPORT_REFRESH_FAILED',
      phase: 'refreshing',
      rolledBack: true,
    })
    const importer = vi.fn().mockRejectedValueOnce(rolledBack)

    render(<ExportPanel model={model} cocosImporter={importer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))
    expect(await screen.findByText(/回滚：已完成/)).toBeTruthy()

    cleanup()
    const noRollback = new CocosBridgeError('IMPORT_FAILED', '校验失败', undefined, {
      jobCode: 'IMPORT_VALIDATION_FAILED',
      phase: 'validating',
      rolledBack: false,
    })
    const secondImporter = vi.fn().mockRejectedValue(noRollback)
    render(<ExportPanel model={model} cocosImporter={secondImporter} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))
    expect(await screen.findByText(/回滚：未执行/)).toBeTruthy()
  })

  it('错误码存在但阶段缺失时使用排队阶段兜底', async () => {
    const error = new CocosBridgeError('IMPORT_FAILED', '任务状态缺失', undefined, {
      jobCode: 'IMPORT_STATUS_INVALID',
      phase: 'queued',
      rolledBack: false,
    })
    Object.defineProperty(error, 'phase', { value: undefined })
    const importer = vi.fn().mockRejectedValue(error)

    render(<ExportPanel model={model} cocosImporter={importer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))

    expect(await screen.findByText(/阶段：Cocos Creator 正在排队/)).toBeTruthy()
  })

  it('导入器抛出非 Error 值时展示通用错误', async () => {
    const importer = vi.fn().mockRejectedValue({ reason: 'offline' })

    render(<ExportPanel model={model} cocosImporter={importer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))

    expect(await screen.findByText('导入失败：未知错误')).toBeTruthy()
  })

  it('Cocos 下载降级失败后显示重试文案和具体原因', async () => {
    const cocosExporter = vi.fn().mockRejectedValue(new Error('图集打包失败'))

    render(<ExportPanel model={model} cocosExporter={cocosExporter} />)
    fireEvent.click(screen.getByRole('button', { name: '下载 Cocos 包' }))

    const retry = await screen.findByRole('button', { name: '重新导出 Cocos 包' })
    expect(retry.getAttribute('title')).toBe('图集打包失败')
    expect(screen.getByText('导出失败：图集打包失败')).toBeTruthy()
  })

  it('可关闭 Cocos 导出入口而不影响通用导出', () => {
    render(<ExportPanel model={model} enableCocosExport={false} />)

    expect(screen.queryByRole('button', { name: '一键导入 Cocos' })).toBeNull()
    expect(screen.queryByRole('button', { name: '下载 Cocos 包' })).toBeNull()
    expect(screen.getByRole('button', { name: '导出游戏资产包' })).toBeTruthy()
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

  it('紧凑导出按钮提供 Cocos Creator 下载降级入口', async () => {
    const cocosExporter = vi.fn().mockResolvedValue({
      blob: new Blob(['cocos-zip'], { type: 'application/zip' }),
      filename: 'windup-cocos.zip',
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:cocos-compact'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<ExportButton model={model} cocosExporter={cocosExporter} />)
    fireEvent.click(screen.getByRole('button', { name: '下载 Cocos 包' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cocos 包下载完成' })).toBeTruthy(),
    )
    expect(cocosExporter).toHaveBeenCalledWith(model, expect.any(Function))
  })

  it('紧凑导出按钮可直接完成 Cocos 一键导入', async () => {
    const importer = vi.fn().mockResolvedValue({
      projectName: 'CompactGame',
      dbUrl: 'db://assets/windup-imports/Aster.prefab',
      animationCount: 1,
      frameCount: 8,
    })

    render(<ExportButton model={model} cocosImporter={importer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))

    expect(await screen.findByText('CompactGame · 1 个动作，8 帧')).toBeTruthy()
    expect(importer).toHaveBeenCalledWith(model, expect.any(Function))
  })

  it('紧凑 Cocos 一键导入失败后显示重试文案', async () => {
    const importer = vi.fn().mockRejectedValue(new Error('导入连接中断'))

    render(<ExportButton model={model} cocosImporter={importer} />)
    fireEvent.click(screen.getByRole('button', { name: '一键导入 Cocos' }))

    expect(await screen.findByRole('button', { name: '重新导入 Cocos' })).toBeTruthy()
    expect(screen.getByText('导入失败：导入连接中断')).toBeTruthy()
  })

  it('紧凑 Cocos 下载失败时显示重试入口、标题和独立警告', async () => {
    const cocosExporter = vi.fn().mockRejectedValue(new Error('Cocos 图集生成失败'))

    render(<ExportButton model={model} cocosExporter={cocosExporter} />)
    fireEvent.click(screen.getByRole('button', { name: '下载 Cocos 包' }))

    const retry = await screen.findByRole('button', { name: '重新导出 Cocos 包' })
    expect(retry.getAttribute('title')).toBe('Cocos 图集生成失败')
    expect(screen.getByText('Cocos 导出失败：Cocos 图集生成失败')).toBeTruthy()
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

  it('紧凑导出按钮可单独关闭 Cocos 入口', () => {
    render(<ExportButton model={model} enableCocosExport={false} />)

    expect(screen.queryByRole('button', { name: '一键导入 Cocos' })).toBeNull()
    expect(screen.queryByRole('button', { name: '下载 Cocos 包' })).toBeNull()
    expect(screen.getByRole('button', { name: '导出完整动作资产' })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('menuitem', { name: /完美像素版/u }))

    await waitFor(() =>
      expect(exporter).toHaveBeenCalledWith(pixelPerfectModel, expect.any(Function)),
    )
    expect(downloads).toEqual(['windup-Aster-character-1-pixel-perfect.zip'])
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
    expect(document.activeElement).toBe(trigger)
    fireEvent.animationEnd(closingMenu)
    await waitFor(() => expect(screen.queryByTestId('asset-version-menu')).toBeNull())
  })
})
