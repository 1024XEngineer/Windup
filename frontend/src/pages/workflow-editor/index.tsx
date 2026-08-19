import {
  Handle,
  Position,
  applyNodeChanges,
  type Edge,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router'

import {
  type ActionPreset,
  type ActionFirstFrameWorkflowNode,
  type ActionFullFrameWorkflowNode,
  type ActionGenerationMethodWorkflowNode,
  type Character,
  type CharacterSetupWorkflowNode,
  type CharacterTemplateWorkflowNode,
  type Generation,
  type MasterPrecheckReport,
  type MasterWarning,
  type MediaReference,
  type Project,
  type Render3DApis,
  type Render3DAsset,
  type ReviewWorkflowNode,
  type WorkflowGenerationRole,
  type WorkflowNode,
  type WorkflowRun,
} from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'
import {
  createProgressiveExportModel,
  ExportButton,
  type ExportPackageModel,
} from '@/features/export-package'
import { loadDefaultActionPresets, type WorkflowEditorSession } from './runtime'
import { useWorkflowEditorSession } from './use-workflow-editor-session'
import { WorkflowEditorView, type WorkflowCardNode } from './workflow-editor-view'
import './workflow-editor.css'

export interface WorkflowEditorPageProps {
  loadSession?: (runId: string) => Promise<WorkflowEditorSession>
}

type ActionMenuLevel = 'root' | 'outfits' | 'actions' | 'custom'

const ACTION_PRESET_HINT = '预设动作 · 逐帧生成'

/** 角色设定与身份母版为所有动作分支共用，归在这条虚拟分支下。 */
const SHARED_BRANCH = 'shared'

/*
  卡片内部复用三次以上的样式串。原来靠 .workflow-card button 这类后代选择器统一施加，
  搬成工具类后写在这里，好处是能看见哪些元素共用同一套外观，而不是被选择器隐式波及。
  nodrag/nopan/nowheel 是 React Flow 的约定类：让卡片内的交互不被画布手势吞掉。
*/
const CARD_STACK = 'grid gap-3 nodrag nopan nowheel'

const CARD_BUTTON_BASE =
  'min-h-9 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-[color,background-color,border-color,transform,box-shadow] ' +
  'duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ' +
  'enabled:active:translate-y-px enabled:active:scale-[0.98] motion-reduce:transform-none disabled:cursor-not-allowed ' +
  'disabled:border-app-line disabled:bg-app-surface-muted disabled:text-app-faint'

const CARD_BUTTON =
  `${CARD_BUTTON_BASE} border-app-accent bg-app-accent text-app-on-accent ` +
  'enabled:hover:border-app-accent-hover enabled:hover:bg-app-accent-hover enabled:hover:shadow-app-menu ' +
  'aria-pressed:border-app-accent-hover aria-pressed:bg-app-accent-hover'

const CARD_BUTTON_SECONDARY =
  `${CARD_BUTTON_BASE} border-app-line-strong bg-app-surface-raised text-app-ink-soft ` +
  'enabled:hover:border-app-accent enabled:hover:bg-app-accent-muted enabled:hover:text-app-accent'

/** 缩略图按钮：沿用卡片按钮的尺寸约定，但换成浅底，让图片自己当主角。 */
const THUMB_BUTTON =
  'min-h-[42px] rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised p-1 ' +
  'transition-[border-color,background-color,transform,box-shadow] duration-150 ease-out ' +
  'hover:border-app-line-strong active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-app-accent motion-reduce:transform-none aria-pressed:border-app-accent ' +
  'aria-pressed:bg-app-surface-raised aria-pressed:shadow-[0_0_0_2px_var(--color-app-accent-soft)] ' +
  'disabled:cursor-not-allowed'

const CARD_SUMMARY =
  'm-0 rounded-lg bg-app-accent-muted px-3 py-2 text-[11px] leading-[1.55] text-app-ink-soft'

const CARD_TEXT = 'm-0 text-[11px] leading-[1.6] text-[var(--color-app-muted)]'

/**
 * 三渲二判据只有一条:该造型有没有已确认的绑骨 3D 模型(`Outfit.model3dUrl`)。
 * 没有就不提供这个选项——猜一个"反正总能兜底成 i2v"等于让用户在不知情下换了路线。
 * 建模型本身是按次计费、每造型一次性(图生 3D + 绑骨),且生成后要人工确认模型才能继续绑骨。
 */
const RENDER3D_UNAVAILABLE_HINT =
  '该造型暂无绑骨 3D 模型，暂不能使用三渲二。到「身份母版」卡片上的「建 3D 资产」建一份：' +
  '图生 3D + 自动绑骨，按次计费、每造型一次性，中间有一道人工确认；不合格只能重新生成，不能修改。'

/** 加号菜单里的条目：撑满菜单宽度的两行文字，跟卡片主按钮完全不同。 */
const MENU_ITEM =
  'flex min-h-0 cursor-pointer flex-col gap-0.5 border-0 px-3 py-[9px] text-left ' +
  'text-[var(--color-app-ink)] not-first:border-t not-first:border-t-app-line ' +
  'enabled:hover:bg-app-accent-muted disabled:cursor-not-allowed disabled:opacity-45'

/**
 * 菜单里的头一条：返回上一级，或 root 层的主入口。比其余条目弱一档，
 * 原样式靠 :first-child 选择器实现，这里改成显式挂类，位置换了也不会失灵。
 */
const MENU_ITEM_LEAD = 'font-medium text-[var(--color-app-muted)]'

const MENU_ITEM_TITLE = 'text-xs font-semibold'
const MENU_ITEM_HINT = 'text-[10px] text-[var(--color-app-muted)]'

const nodeTypes = { 'workflow-card': WorkflowCard }

/**
 * 页面只订阅 Controller 的 WorkflowRun 并把它投影为画布；选择、菜单、位置和 busy
 * 都是临时 UI 状态，不会写出第二份流程状态机。
 */
export function WorkflowEditorPage({ loadSession }: WorkflowEditorPageProps = {}) {
  const { runId } = useParams<{ runId: string }>()
  const location = useLocation()
  const { state, retryGenerations, runCommand, setCharacter } = useWorkflowEditorSession(
    runId,
    loadSession,
  )
  const {
    session,
    character,
    run,
    generations,
    busyBranches,
    error,
    workflowConflict,
    resumeError,
    generationReadError,
  } = state
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({})
  const [setupPromptDrafts, setSetupPromptDrafts] = useState<Record<string, string>>({})
  const [actionPromptDraft, setActionPromptDraft] = useState('')
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [actionMenuLevel, setActionMenuLevel] = useState<ActionMenuLevel>('root')
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(null)
  const [canvasNodes, setCanvasNodes] = useState<WorkflowCardNode[]>([])
  const [actionPresets, setActionPresets] = useState<ActionPreset[] | null>(null)
  const [actionPresetError, setActionPresetError] = useState<string | null>(null)

  // 预设文案的唯一真相源在后端（它归措辞门禁管），这里只读一次。菜单打开前就取，
  // 免得用户点开看到空的再等一次网络往返。
  useEffect(() => {
    const abort = new AbortController()
    loadDefaultActionPresets(abort.signal)
      .then((presets) => setActionPresets(presets))
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return
        setActionPresetError(errorMessage(cause, '读取动作预设失败'))
      })
    return () => abort.abort()
  }, [])

  useEffect(() => {
    setSelectedImages({})
    setSetupPromptDrafts({})
    setActionPromptDraft('')
    setActionMenuOpen(false)
    setActionMenuLevel('root')
    setSelectedOutfitId(null)
    setCanvasNodes([])
  }, [runId])

  const exportModels = useMemo(() => {
    const models = new Map<string, ExportPackageModel>()
    if (!character || !run || !session) return models
    const completedGenerations = Object.values(generations).filter(
      (generation): generation is Generation => generation !== null,
    )
    for (const outfit of character.outfits) {
      try {
        models.set(
          outfit.id,
          createProgressiveExportModel({
            project: session.project,
            character,
            outfitId: outfit.id,
            run,
            generations: completedGenerations,
          }),
        )
      } catch {
        // 造型未达到最低导出条件时不显示导出入口。
      }
    }
    return models
  }, [character, generations, run, session])

  const projected = useMemo(
    () =>
      run && session
        ? projectCanvas({
            run,
            controller: session.controller,
            confirmCharacterTemplate: session.confirmCharacterTemplate,
            uploadReferenceImage: session.uploadReferenceImage,
            publishReviewedAction: session.publishReviewedAction,
            project: session.project,
            render3d: session.render3d,
            character,
            generations,
            exportModels,
            selectedImages,
            setupPromptDrafts,
            actionPromptDraft,
            actionMenuOpen,
            actionMenuLevel,
            actionPresets,
            actionPresetError,
            selectedOutfitId,
            busyBranches,
            resumeBlocked: Boolean(resumeError),
            setSelectedImages,
            setSetupPromptDrafts,
            setActionPromptDraft,
            setActionMenuOpen,
            setActionMenuLevel,
            setSelectedOutfitId,
            setCharacter,
            runCommand,
          })
        : { nodes: [] as WorkflowCardNode[], edges: [] as Edge[] },
    [
      actionMenuOpen,
      actionMenuLevel,
      actionPresets,
      actionPresetError,
      actionPromptDraft,
      busyBranches,
      character,
      exportModels,
      generations,
      run,
      runCommand,
      resumeError,
      selectedImages,
      setCharacter,
      setupPromptDrafts,
      selectedOutfitId,
      session,
    ],
  )

  useEffect(() => {
    setCanvasNodes((previous) =>
      projected.nodes.map((node) => ({
        ...node,
        position: previous.find((candidate) => candidate.id === node.id)?.position ?? node.position,
      })),
    )
  }, [projected.nodes])

  function onNodesChange(changes: NodeChange<WorkflowCardNode>[]) {
    const safeChanges = changes.filter((change) => change.type !== 'remove')
    setCanvasNodes((nodes) => applyNodeChanges(safeChanges, nodes))
  }

  if (!runId) {
    return <EditorBoundary message="需要从已有 WorkflowRun 进入" />
  }

  if (error && !run) {
    return <EditorBoundary message={error} />
  }

  if (!session || !run) {
    return <EditorBoundary message="正在恢复 WorkflowRun" />
  }

  const visibleError = error ?? resumeError ?? generationReadError

  return (
    <WorkflowEditorView
      project={session.project}
      run={run}
      nodes={canvasNodes}
      edges={projected.edges}
      nodeTypes={nodeTypes}
      error={visibleError}
      workflowConflict={workflowConflict}
      generationReadError={!error && !resumeError ? generationReadError : null}
      reloadTo={`${location.pathname}${location.search}${location.hash}`}
      onRetryGenerations={retryGenerations}
      onNodesChange={onNodesChange}
    />
  )
}

interface ProjectionInput {
  run: WorkflowRun
  controller: WorkflowController
  confirmCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    selectedImageUrl: string,
  ): Promise<Character>
  uploadReferenceImage(file: File, signal?: AbortSignal): Promise<MediaReference>
  publishReviewedAction(reviewNodeId: ReviewWorkflowNode['id']): Promise<Character>
  project: Project
  character: Character | null
  /** 母版预检与建 3D 资产；页面不直连适配器，替身注入只有会话这一个入口。 */
  render3d: Render3DApis
  generations: Record<string, Generation | null>
  exportModels: ReadonlyMap<string, ExportPackageModel>
  selectedImages: Record<string, string>
  setupPromptDrafts: Record<string, string>
  actionPromptDraft: string
  actionMenuOpen: boolean
  actionMenuLevel: ActionMenuLevel
  /** 后端预设。null = 还没拿到（加载中或失败），与"拿到了但是空表"必须分得开。 */
  actionPresets: ActionPreset[] | null
  actionPresetError: string | null
  selectedOutfitId: string | null
  busyBranches: ReadonlySet<string>
  resumeBlocked: boolean
  setSelectedImages: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setSetupPromptDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setActionPromptDraft(value: string): void
  setActionMenuOpen(open: boolean): void
  setActionMenuLevel(level: ActionMenuLevel): void
  setSelectedOutfitId(outfitId: string | null): void
  setCharacter(character: Character): void
  runCommand(branchKey: string, command: () => Promise<void>, onSuccess?: () => void): void
}

function NodeExportButton({ model }: { model: ExportPackageModel | undefined }) {
  return model ? (
    <ExportButton model={model} className={`${CARD_BUTTON_SECONDARY} nodrag nopan nowheel`} />
  ) : null
}

/** 卡片自己所属的分支；命令与禁用判断都以它为准。 */
function branchKeyOf(node: WorkflowNode, input: ProjectionInput): string {
  return branchKeyFor(node, new Map(input.run.nodes.map((candidate) => [candidate.id, candidate])))
}

function projectCanvas(input: ProjectionInput): {
  nodes: WorkflowCardNode[]
  edges: Edge[]
} {
  const activeNodes = input.run.nodes.filter((node) => !node.deletedAt)
  const actionRootIds = activeNodes
    .filter((node) => node.type === 'action-first-frame')
    .map((node) => node.id)
  const nodesById = new Map(activeNodes.map((node) => [node.id, node]))
  const nodes = activeNodes.map((node) =>
    toCanvasNode(node, branchIndexFor(branchKeyFor(node, nodesById), actionRootIds), input),
  )
  const edges: Edge[] = activeNodes.flatMap((node) => {
    const confirmed = node.status === 'passed'
    return node.dependsOnNodeIds.map((source) => ({
      id: `${source}->${node.id}`,
      source,
      target: node.id,
      selectable: false,
      deletable: false,
      className: confirmed ? 'workflow-edge--confirmed' : 'workflow-edge--flowing',
    }))
  })

  return { nodes, edges }
}

function toCanvasNode(
  node: WorkflowNode,
  branchIndex: number,
  input: ProjectionInput,
): WorkflowCardNode {
  return {
    id: node.id,
    type: 'workflow-card',
    position: positionFor(node.type, branchIndex),
    zIndex: node.type === 'character-template' && input.actionMenuOpen ? 1000 : 0,
    draggable: true,
    dragHandle: '.workflow-card__handle',
    deletable: false,
    data: {
      eyebrow: CARD_LABELS[node.type].eyebrow,
      title: CARD_LABELS[node.type].title,
      status: node.status,
      content: contentFor(node, input),
    },
  }
}

function contentFor(node: WorkflowNode, input: ProjectionInput): ReactNode {
  if (node.type === 'character-setup') return <CharacterSetupContent node={node} input={input} />
  if (node.type === 'character-template') {
    return <CharacterTemplateContent node={node} input={input} />
  }
  if (node.type === 'action-first-frame') return <FirstFrameContent node={node} input={input} />
  if (node.type === 'action-generation-method') return <MethodContent node={node} input={input} />
  if (node.type === 'action-full-frame') return <AnimationContent node={node} input={input} />
  return <ReviewContent node={node} input={input} />
}

type WorkflowImageVariant = 'master' | 'thumbnail' | 'frame'

/** 图片先占住最终版面，再从骨架淡入，避免远程资产到达时把节点和连线一起顶动。 */
function WorkflowImage({
  src,
  alt,
  variant,
}: {
  src: string
  alt: string
  variant: WorkflowImageVariant
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')

  useEffect(() => setState('loading'), [src])

  const frameClass =
    variant === 'master'
      ? 'aspect-[4/3] rounded-lg border border-app-line bg-app-surface'
      : variant === 'thumbnail'
        ? 'aspect-square rounded-md bg-app-surface'
        : 'aspect-square rounded border border-app-line bg-app-surface'
  const imageClass =
    variant === 'master' ? 'object-contain p-2 [image-rendering:pixelated]' : 'object-cover'

  return (
    <span className={`relative block w-full overflow-hidden ${frameClass}`}>
      {state === 'loading' ? (
        <span
          role="status"
          aria-label={`正在加载${alt}`}
          className="workflow-image-skeleton absolute inset-0"
        />
      ) : null}
      {state === 'failed' ? (
        <span className="absolute inset-0 grid place-items-center px-2 text-center text-[10px] text-app-faint">
          图片加载失败
        </span>
      ) : null}
      <img
        className={`absolute inset-0 block h-full w-full transition-opacity duration-200 ease-out motion-reduce:transition-none ${imageClass} ${
          state === 'loaded' ? 'opacity-100' : 'opacity-0'
        }`}
        src={src}
        alt={alt}
        onLoad={() => setState('loaded')}
        onError={() => setState('failed')}
      />
    </span>
  )
}

function CharacterSetupContent({
  node,
  input,
}: {
  node: CharacterSetupWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const prompt = input.setupPromptDrafts[node.id] ?? node.input.prompt
  const [uploadingReference, setUploadingReference] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)

  useEffect(() => () => uploadAbortRef.current?.abort(), [])

  function uploadReferenceImage(file: File) {
    const uploadAbort = new AbortController()
    uploadAbortRef.current = uploadAbort
    setUploadingReference(true)
    setUploadError(null)
    void input
      .uploadReferenceImage(file, uploadAbort.signal)
      .then((reference) => {
        if (uploadAbort.signal.aborted) return
        return input.controller.updateCharacterSetup(node.id, {
          prompt,
          referenceMedia: [reference],
        })
      })
      .catch((cause: unknown) => {
        if (uploadAbort.signal.aborted) return
        setUploadError(errorMessage(cause, '上传参考图失败'))
      })
      .finally(() => {
        if (uploadAbort.signal.aborted) return
        uploadAbortRef.current = null
        setUploadingReference(false)
      })
  }

  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.status === 'passed') return <p className={CARD_SUMMARY}>角色描述已确认</p>
  return (
    <div className={CARD_STACK}>
      <label className="grid gap-[7px]">
        <span className="text-[9px] font-[750] text-app-muted">角色描述</span>
        <textarea
          aria-label="角色描述"
          rows={4}
          className="min-h-[84px] w-full resize-y rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised px-3 py-2.5 font-[inherit] text-[11px] leading-[1.55] text-[var(--color-app-ink)] focus:border-app-accent focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-app-accent-soft"
          value={prompt}
          disabled={branchBusy || uploadingReference}
          onChange={(event) => {
            const value = event.target.value
            input.setSetupPromptDrafts((drafts) => ({ ...drafts, [node.id]: value }))
          }}
        />
        {node.input.referenceMedia.length > 0 ? (
          <small className="text-[9px] font-[750] text-app-muted">
            已关联 {node.input.referenceMedia.length} 个参考媒体
          </small>
        ) : null}
      </label>
      <div className="grid gap-[7px]">
        <span className="text-[9px] font-[750] text-app-muted">角色参考图（选填）</span>
        <input
          type="file"
          accept="image/*"
          aria-label="角色参考图"
          className="block w-full rounded-lg border border-[var(--color-app-line)] bg-app-surface text-[10px] text-[var(--color-app-muted)] file:mr-3 file:border-0 file:border-r file:border-[var(--color-app-line)] file:bg-transparent file:px-3 file:py-2 file:text-[10px] file:font-[700] file:text-[var(--color-app-ink)]"
          disabled={branchBusy || uploadingReference}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) uploadReferenceImage(file)
          }}
        />
        {uploadingReference ? (
          <small role="status" className="text-[9px] font-[750] text-app-muted">
            正在上传参考图…
          </small>
        ) : null}
        {uploadError ? (
          <p
            role="alert"
            className="m-0 rounded-lg border border-app-danger-line bg-app-danger-soft px-2.5 py-2 text-[9px] leading-[1.5] text-app-danger"
          >
            {uploadError}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy || uploadingReference || !prompt.trim()}
        onClick={() =>
          input.runCommand(branchKey, () =>
            input.controller.generateCharacterTemplate(node.id, {
              spriteWidth: input.project.spriteSize.width,
              spriteHeight: input.project.spriteSize.height,
              input: {
                prompt,
                referenceMedia: node.input.referenceMedia,
              },
            }),
          )
        }
      >
        生成角色候选
      </button>
    </div>
  )
}

function CharacterTemplateContent({
  node,
  input,
}: {
  node: CharacterTemplateWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const [refining, setRefining] = useState(false)
  const [adjustmentPrompt, setAdjustmentPrompt] = useState('')
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'ready' && node.status === 'active') {
    const setupNode = findDependency(input.run, node, 'character-setup')
    return (
      <button
        type="button"
        className={`${CARD_BUTTON} nodrag nopan nowheel`}
        disabled={!setupNode || branchBusy}
        onClick={() => {
          if (!setupNode) return
          input.runCommand(branchKey, () =>
            input.controller.generateCharacterTemplate(setupNode.id, {
              spriteWidth: input.project.spriteSize.width,
              spriteHeight: input.project.spriteSize.height,
            }),
          )
        }}
      >
        生成角色候选
      </button>
    )
  }
  if (node.phase === 'selecting') {
    const result = input.generations[generationKey(node.id, 'character_template')]?.result
    const images = result?.type === 'character_template' ? result.images : []
    const selectedImageUrl =
      images.find((image) => image.url === input.selectedImages[node.id])?.url ?? null
    return (
      <div className={CARD_STACK}>
        <div className="grid grid-cols-2 gap-[7px]">
          {images.map((image, index) => (
            <button
              type="button"
              key={image.url}
              className={THUMB_BUTTON}
              aria-label={`选择角色候选 ${index + 1}`}
              aria-pressed={selectedImageUrl === image.url}
              onClick={() =>
                input.setSelectedImages((selected) => ({
                  ...selected,
                  [node.id]: image.url,
                }))
              }
            >
              <WorkflowImage src={image.url} alt={`角色候选 ${index + 1}`} variant="thumbnail" />
            </button>
          ))}
        </div>
        {selectedImageUrl ? (
          <MasterGate
            node={node}
            input={input}
            imageUrl={selectedImageUrl}
            branchKey={branchKey}
            branchBusy={branchBusy}
          />
        ) : (
          <p className={CARD_TEXT}>先选一张候选，再决定是否把它定为母版。</p>
        )}
      </div>
    )
  }
  if (node.status === 'passed' && node.selectedImageUrl) {
    const outfit =
      input.character?.outfits.find(
        (candidate) => candidate.previewUrl === node.selectedImageUrl,
      ) ?? input.character?.outfits[0]
    return (
      <div className={CARD_STACK}>
        <WorkflowImage src={node.selectedImageUrl} alt="已确认身份母版" variant="master" />
        <span className="text-center text-[11px] text-[var(--color-app-muted)]">身份已锁定</span>
        {input.character && outfit ? (
          <Render3DAssetPanel
            input={input}
            characterId={input.character.id}
            outfitId={outfit.id}
            hasModel={Boolean(outfit.model3dUrl)}
          />
        ) : null}
        {outfit ? <NodeExportButton model={input.exportModels.get(outfit.id)} /> : null}
        <div className="grid gap-2">
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={branchBusy}
            onClick={() =>
              input.runCommand(branchKey, () =>
                input.controller.regenerateCharacterTemplate(node.id, {
                  spriteWidth: input.project.spriteSize.width,
                  spriteHeight: input.project.spriteSize.height,
                  mode: 'regenerate',
                }),
              )
            }
          >
            重新生成角色母版
          </button>
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={branchBusy}
            onClick={() => setRefining((active) => !active)}
          >
            微调角色母版
          </button>
          {refining ? (
            <div className="grid gap-2">
              <textarea
                aria-label="角色母版微调描述"
                rows={3}
                className="min-h-[64px] w-full resize-y rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised px-3 py-2.5 font-[inherit] text-[11px] leading-[1.55] text-[var(--color-app-ink)] focus:border-app-accent focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-app-accent-soft"
                value={adjustmentPrompt}
                disabled={branchBusy}
                onChange={(event) => setAdjustmentPrompt(event.target.value)}
              />
              <button
                type="button"
                className={CARD_BUTTON}
                disabled={branchBusy || !adjustmentPrompt.trim()}
                onClick={() => {
                  const prompt = adjustmentPrompt.trim()
                  if (!prompt) return
                  input.runCommand(
                    branchKey,
                    () =>
                      input.controller.regenerateCharacterTemplate(node.id, {
                        spriteWidth: input.project.spriteSize.width,
                        spriteHeight: input.project.spriteSize.height,
                        mode: 'refine',
                        adjustmentPrompt: prompt,
                      }),
                    () => {
                      setRefining(false)
                      setAdjustmentPrompt('')
                    },
                  )
                }}
              >
                提交角色母版微调
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="absolute -bottom-3.5 -right-3.5 z-8 grid h-8 min-h-8 w-8 place-items-center rounded-full border border-app-line-strong bg-app-surface-raised p-0 text-[15px] leading-none text-app-accent shadow-app-menu transition-[color,background-color,border-color,transform,box-shadow] duration-150 ease-out hover:border-app-accent hover:bg-app-accent-muted hover:shadow-app-card active:translate-y-px active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent motion-reduce:transform-none"
          aria-label="添加动作分支"
          onClick={() => {
            input.setActionMenuLevel('root')
            input.setSelectedOutfitId(null)
            input.setActionMenuOpen(!input.actionMenuOpen)
          }}
        >
          ＋
        </button>
        {input.actionMenuOpen ? (
          <div className="absolute left-[calc(100%+24px)] top-[calc(100%-16px)] z-7 flex min-w-[190px] flex-col overflow-hidden rounded-xl border border-[var(--color-app-line)] bg-app-surface-raised shadow-[var(--shadow-app-panel)]">
            <ActionMenu input={input} templateNodeId={node.id} />
          </div>
        ) : null}
      </div>
    )
  }
  return <StatusText node={node} input={input} />
}

/**
 * 母版确认闸：挑中候选之后、把它当母版用之前的那个停点。
 *
 * 为什么这道闸值得存在：一张母版约 ¥0.29，图生 3D 一次 ¥2.40，而混元的模型**生成即
 * 最终**（拓扑、绑点在生成那一步定死，事后改不动）。母版不合格 → 模型必然不合格 →
 * 只能整个重来。所以要在最便宜的位置纠错，而不是等模型出来再看。
 *
 * 闸上摆的是**零成本就能判的**那几条（后端 master_check）。判不了的（画的是不是这个
 * 角色、朝向对不对、画面里有没有文字）由人自己看放大图 —— 所以放大图是这道闸的主体，
 * 预检只是旁证。
 */
function MasterGate({
  node,
  input,
  imageUrl,
  branchKey,
  branchBusy,
}: {
  node: CharacterTemplateWorkflowNode
  input: ProjectionInput
  imageUrl: string
  branchKey: string
  branchBusy: boolean
}) {
  const precheck = useMasterPrecheck(input, imageUrl)
  const setupNode = findDependency(input.run, node, 'character-setup')
  const rejected = precheck.status === 'done' && !precheck.report.accepted

  return (
    <div className={CARD_STACK}>
      <WorkflowImage src={imageUrl} alt="待确认定妆母版" variant="master" />
      <MasterPrecheckReadout state={precheck} />
      <button
        type="button"
        className={CARD_BUTTON}
        // 预检的判据是近似的（面积比、连通块数），会误判；它拦下来的图未必真不能用。
        // 所以拒绝只改文案不改可用性——把"这张不行"的决定权留给看得见图的人。
        disabled={branchBusy}
        title={rejected ? precheck.report.detail : undefined}
        onClick={() =>
          input.runCommand(branchKey, async () => {
            const character = await input.confirmCharacterTemplate(node.id, imageUrl)
            input.setCharacter(character)
          })
        }
      >
        确认为定妆母版
      </button>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy || !setupNode}
        onClick={() => {
          if (!setupNode) return
          input.setSelectedImages((selected) => {
            const next = { ...selected }
            delete next[node.id]
            return next
          })
          // 先复位再重生成：不复位的话新的三张会挂在一个仍处于 selecting 的节点上，
          // 页面会把旧的选择当成对新候选的选择。
          input.runCommand(branchKey, async () => {
            await input.controller.restartFromNode(node.id)
            await input.controller.generateCharacterTemplate(setupNode.id, {
              spriteWidth: input.project.spriteSize.width,
              spriteHeight: input.project.spriteSize.height,
            })
          })
        }}
      >
        重新生成三张
      </button>
    </div>
  )
}

type MasterPrecheckState =
  | { status: 'loading' }
  | { status: 'done'; report: MasterPrecheckReport }
  | { status: 'error'; message: string }

/** 预检失败不影响确认：它是旁证，不是准入条件。判据坏了不该连带把人挡在外面。 */
function useMasterPrecheck(input: ProjectionInput, imageUrl: string): MasterPrecheckState {
  const [state, setState] = useState<MasterPrecheckState>({ status: 'loading' })
  const { render3d } = input
  const { width, height } = input.project.spriteSize

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void render3d
      .precheckMaster(imageUrl, { width, height })
      .then((report) => {
        if (!cancelled) setState({ status: 'done', report })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(cause, '母版预检失败') })
      })
    return () => {
      cancelled = true
    }
  }, [height, imageUrl, render3d, width])

  return state
}

const WARNING_TITLE: Record<MasterWarning['code'], string> = {
  limbs_fused: '双腿可能粘连',
  extra_component: '画面里还有别的东西',
}

function MasterPrecheckReadout({ state }: { state: MasterPrecheckState }) {
  if (state.status === 'loading') {
    return (
      <p className={CARD_SUMMARY} role="status">
        正在预检母版…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <p className={CARD_SUMMARY}>
        母版预检没跑成：{state.message}。这不影响确认，但下一步的形态问题得你自己看。
      </p>
    )
  }
  const { report } = state
  if (!report.accepted) {
    return (
      <p
        role="alert"
        className="m-0 rounded-[10px] border border-app-danger-line bg-app-danger-soft px-3 py-2.5 text-[11px] leading-[1.6] text-app-danger"
      >
        这张不能用：{report.detail}
      </p>
    )
  }
  return (
    <div className={CARD_STACK}>
      <p className={CARD_SUMMARY}>{report.detail}</p>
      {report.warnings.map((warning) => (
        <p key={warning.code} className={CARD_SUMMARY}>
          <b>{WARNING_TITLE[warning.code]}</b>
          <br />
          {warning.detail}
        </p>
      ))}
    </div>
  )
}

/**
 * 建 3D 资产：把 `Render3DAssetBuilder` 那条链交到用户手里。
 *
 * 三件事不能省：
 *  - **成本先说**。图生 3D + 绑骨按次计费，每造型一次性；数字由后端从计费实现取，
 *    这里不抄常量。用户不知情就触发按次计费是红线。
 *  - **人工确认闸不能自动放行**。模型出来后停在 `awaiting_review`，等人点头才绑骨。
 *  - **不装进度条**。没有 3D 预览能力，就给状态、给模型下载地址、给怎么看的说明，
 *    而不是转一个和真实进度无关的圈。
 */
function Render3DAssetPanel({
  input,
  characterId,
  outfitId,
  hasModel,
}: {
  input: ProjectionInput
  characterId: string
  outfitId: string
  hasModel: boolean
}) {
  const { render3d } = input
  const [asset, setAsset] = useState<Render3DAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const inFlight = asset?.state === 'building' || asset?.state === 'rigging'

  useEffect(() => {
    let cancelled = false
    const read = () =>
      render3d
        .getOutfitAsset(characterId, outfitId)
        .then((next) => {
          if (!cancelled) setAsset(next)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(errorMessage(cause, '读取 3D 资产状态失败'))
        })
    void read()
    // 两段付费调用各要几十秒到几分钟，跑在后端线程上，只能轮询。停在闸上时不轮询——
    // 那个状态只会因为人点按钮而改变，轮询它纯属浪费。
    if (!inFlight)
      return () => {
        cancelled = true
      }
    const timer = window.setInterval(() => void read(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [characterId, inFlight, outfitId, refreshKey, render3d])

  // 轮询拿到 ready 时,页面级 Character 还停在旧值,而三渲二能不能选读的正是它
  // (`outfits[].model3dUrl`)。不回填的话,用户等完两段付费流程仍看到那条路线是灰的,
  // 得整页刷新才能继续 —— 刚花掉三十积分的人最不该撞上这个。
  // 守卫只用 hasModel,不另设"同步过了"的一次性开关:那种开关在 Character 被别处
  // 重新拉取、回到没有 model3dUrl 的旧值时就再也不会补,又退回"必须刷新页面"。
  useEffect(() => {
    if (asset?.state !== 'ready' || !asset.model3dUrl || hasModel) return
    const character = input.character
    if (!character) return
    input.setCharacter({
      ...character,
      outfits: character.outfits.map((outfit) =>
        outfit.id === outfitId ? { ...outfit, model3dUrl: asset.model3dUrl } : outfit,
      ),
    })
  }, [asset, hasModel, input, outfitId])

  const act = (operation: () => Promise<Render3DAsset>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    void operation()
      .then((next) => setAsset(next))
      .catch((cause: unknown) => setError(errorMessage(cause, '操作 3D 资产失败')))
      .finally(() => {
        setBusy(false)
        setRefreshKey((key) => key + 1)
      })
  }

  if (!asset) {
    return <p className={CARD_SUMMARY}>{error ?? '正在读取 3D 资产状态…'}</p>
  }

  const cost = asset.cost
  const costLine =
    `图生 3D ${cost.model3dCredits} 积分 + 绑骨 ${cost.autorigCredits} 积分 = ` +
    `${cost.totalCredits} 积分（后付费约 ¥${cost.totalCny}）。每造型一次性，做多少个动作都不再收。`

  return (
    <section className={CARD_STACK} aria-label="三渲二 3D 资产">
      {error ? <p className={CARD_SUMMARY}>{error}</p> : null}
      {asset.state === 'absent' || asset.state === 'failed' ? (
        <>
          <p className={CARD_SUMMARY}>{costLine}</p>
          {asset.state === 'failed' && asset.error ? (
            <p className={CARD_SUMMARY}>上次没建成：{asset.error}</p>
          ) : null}
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={busy}
            onClick={() => act(() => render3d.buildOutfitAsset(characterId, outfitId))}
          >
            建 3D 资产（{cost.totalCredits} 积分 · 约 ¥{cost.totalCny}）
          </button>
        </>
      ) : null}

      {asset.state === 'building' ? (
        <p className={CARD_SUMMARY} role="status">
          正在图生 3D（{cost.model3dCredits} 积分已计费）。这一步几十秒到几分钟，
          出来后会停下来等你确认，不会自己接着绑骨。
        </p>
      ) : null}

      {asset.state === 'awaiting_review' ? (
        <>
          <p className={CARD_SUMMARY}>
            模型已生成，等你确认。<b>混元的模型改不动</b>——不合格只能重新生成，
            所以这一步别放水：绑骨还要再花 {cost.autorigCredits} 积分。
          </p>
          {asset.reviewModelUrl ? (
            <p className={CARD_TEXT}>
              <a href={asset.reviewModelUrl} target="_blank" rel="noreferrer">
                下载待审模型（.glb）
              </a>
              ：用 Blender 或任意 glTF 查看器打开，看四肢有没有粘连、有没有多出来的物体。
            </p>
          ) : (
            <p className={CARD_TEXT}>待审模型暂时取不到地址，先别放行。</p>
          )}
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={busy}
            onClick={() => act(() => render3d.approveOutfitAsset(characterId, outfitId))}
          >
            通过 · 继续绑骨（{cost.autorigCredits} 积分）
          </button>
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={busy}
            onClick={() => act(() => render3d.discardOutfitAsset(characterId, outfitId))}
          >
            不合格 · 重新生成（再花 {cost.model3dCredits} 积分）
          </button>
        </>
      ) : null}

      {asset.state === 'rigging' ? (
        <p className={CARD_SUMMARY} role="status">
          正在自动绑骨（{cost.autorigCredits} 积分已计费）。完成后这个造型就能选三渲二了。
        </p>
      ) : null}

      {asset.state === 'ready' ? (
        <p className={CARD_SUMMARY}>3D 资产已就绪，这个造型可以走三渲二了。</p>
      ) : null}
    </section>
  )
}

function ActionMenu({ input, templateNodeId }: { input: ProjectionInput; templateNodeId: string }) {
  const outfits = input.character?.outfits ?? []
  const selectedOutfit = outfits.find((outfit) => outfit.id === input.selectedOutfitId) ?? null
  // 菜单挂在身份母版上，新增分支属于共享区的操作。
  const branchBusy = input.busyBranches.has(SHARED_BRANCH)

  if (input.actionMenuLevel === 'root') {
    return (
      <div className="contents">
        <button
          type="button"
          className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
          disabled={outfits.length === 0 || branchBusy}
          onClick={() => {
            if (outfits.length === 1) {
              input.setSelectedOutfitId(outfits[0]!.id)
              input.setActionMenuLevel('actions')
              return
            }
            input.setActionMenuLevel('outfits')
          }}
        >
          <b className={MENU_ITEM_TITLE}>生成动作 ›</b>
        </button>
        <button type="button" className={MENU_ITEM} disabled>
          <b className={MENU_ITEM_TITLE}>生成静态资产</b>
          <small className={MENU_ITEM_HINT}>本期不做，需单独提案</small>
        </button>
        <button type="button" className={MENU_ITEM} disabled>
          <b className={MENU_ITEM_TITLE}>导出</b>
          <small className={MENU_ITEM_HINT}>完成审核后打包动作</small>
        </button>
      </div>
    )
  }

  if (input.actionMenuLevel === 'outfits') {
    return (
      <div className="contents">
        <button
          type="button"
          className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
          onClick={() => input.setActionMenuLevel('root')}
        >
          ← 选择造型
        </button>
        {outfits.map((outfit) => (
          <button
            type="button"
            key={outfit.id}
            className={MENU_ITEM}
            aria-label={`选择造型 ${outfit.name}`}
            onClick={() => {
              input.setSelectedOutfitId(outfit.id)
              input.setActionMenuLevel('actions')
            }}
          >
            <b className={MENU_ITEM_TITLE}>{outfit.name}</b>
            <small className={MENU_ITEM_HINT}>{outfit.description ?? '使用此造型生成动作'}</small>
          </button>
        ))}
      </div>
    )
  }

  if (input.actionMenuLevel === 'custom') {
    const prompt = input.actionPromptDraft.trim()
    return (
      <div className="contents">
        <button
          type="button"
          className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
          onClick={() => input.setActionMenuLevel('actions')}
        >
          ← 生成动作
        </button>
        <label className="flex flex-col gap-1.5 border-t border-app-line px-3 py-2.5 text-[10px] font-semibold text-app-muted">
          动作描述
          <textarea
            aria-label="动作描述"
            value={input.actionPromptDraft}
            onChange={(event) => input.setActionPromptDraft(event.target.value)}
            placeholder="例如：挥手打招呼、蹲下查看地面"
            rows={3}
            className="nodrag nopan nowheel min-h-20 resize-y rounded-md border border-app-line-strong bg-app-surface p-2 text-[11px] font-normal text-app-ink outline-none focus:border-app-accent"
          />
        </label>
        <button
          type="button"
          className={MENU_ITEM}
          disabled={!selectedOutfit || !prompt || branchBusy}
          onClick={() => {
            if (!selectedOutfit || !prompt) return
            input.runCommand(SHARED_BRANCH, () =>
              input.controller.addAction({
                dependsOnNodeIds: [templateNodeId],
                input: {
                  outfitId: selectedOutfit.id,
                  name: prompt,
                  type: 'custom',
                  prompt,
                  fps: 12,
                },
              }),
            )
            input.setActionPromptDraft('')
            input.setActionMenuOpen(false)
            input.setActionMenuLevel('root')
            input.setSelectedOutfitId(null)
          }}
        >
          <b className={MENU_ITEM_TITLE}>开始生成</b>
          <small className={MENU_ITEM_HINT}>创建自定义动作分支</small>
        </button>
      </div>
    )
  }

  return (
    <div className="contents">
      <button
        type="button"
        className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
        onClick={() => input.setActionMenuLevel(outfits.length > 1 ? 'outfits' : 'root')}
      >
        ← 生成动作
      </button>
      {input.actionPresets === null ? (
        // 拿不到就说拿不到,不退回一份前端副本兜底:那份副本正是本次要消除的东西,
        // 而"菜单看起来正常、发出去的描述却是旧文案"比空菜单难查得多。
        <p className={MENU_ITEM_HINT + ' px-3 py-[9px]'}>
          {input.actionPresetError ?? '正在读取动作预设…'}
        </p>
      ) : (
        input.actionPresets.map((preset) => (
          <button
            type="button"
            key={preset.type}
            className={MENU_ITEM}
            disabled={!selectedOutfit || branchBusy}
            onClick={() => {
              if (!selectedOutfit) return
              input.runCommand(SHARED_BRANCH, () =>
                input.controller.addAction({
                  dependsOnNodeIds: [templateNodeId],
                  input: {
                    outfitId: selectedOutfit.id,
                    name: preset.name,
                    type: preset.type,
                    prompt: preset.description,
                    fps: 12,
                  },
                }),
              )
              input.setActionMenuOpen(false)
              input.setActionMenuLevel('root')
              input.setSelectedOutfitId(null)
            }}
          >
            <b className={MENU_ITEM_TITLE}>{preset.label}</b>
            <small className={MENU_ITEM_HINT}>{ACTION_PRESET_HINT}</small>
          </button>
        ))
      )}
      <button
        type="button"
        className={MENU_ITEM}
        disabled={!selectedOutfit || branchBusy}
        onClick={() => {
          input.setActionPromptDraft('')
          input.setActionMenuLevel('custom')
        }}
      >
        <b className={MENU_ITEM_TITLE}>自定义动作</b>
        <small className={MENU_ITEM_HINT}>输入描述后生成</small>
      </button>
    </div>
  )
}

function FirstFrameContent({
  node,
  input,
}: {
  node: ActionFirstFrameWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const [refining, setRefining] = useState(false)
  const [adjustmentPrompt, setAdjustmentPrompt] = useState('')
  const result = input.generations[generationKey(node.id, 'first_frame')]?.result
  const images = result?.type === 'first_frame' ? result.images : []
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'configuring') {
    const character = characterOwningOutfit(input.character, node.input.outfitId)
    return (
      <div className={CARD_STACK}>
        <p className={CARD_TEXT}>
          {node.input.name} · {node.input.fps} FPS
        </p>
        <p className={CARD_TEXT}>{node.input.prompt ?? '无额外动作描述'}</p>
        <button
          type="button"
          className={CARD_BUTTON}
          disabled={!character || branchBusy}
          onClick={() => {
            if (!character) return
            input.runCommand(branchKey, () =>
              input.controller.generateFirstFrame(node.id, {
                spriteWidth: input.project.spriteSize.width,
                spriteHeight: input.project.spriteSize.height,
              }),
            )
          }}
        >
          生成动作首帧
        </button>
      </div>
    )
  }
  if (node.phase === 'selecting' && images.length > 0) {
    const selectedImageUrl = images.some((image) => image.url === input.selectedImages[node.id])
      ? input.selectedImages[node.id]!
      : null
    return (
      <div className={CARD_STACK}>
        <div className="grid grid-cols-3 gap-2">
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              className={THUMB_BUTTON}
              aria-label={`选择动作首帧 ${index + 1}`}
              aria-pressed={selectedImageUrl === image.url}
              onClick={() =>
                input.setSelectedImages((selected) => ({
                  ...selected,
                  [node.id]: image.url,
                }))
              }
            >
              <WorkflowImage
                src={image.url}
                alt={`动作首帧候选 ${index + 1}`}
                variant="thumbnail"
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          className={CARD_BUTTON}
          disabled={!selectedImageUrl || branchBusy}
          onClick={() =>
            input.runCommand(branchKey, () =>
              input.controller.confirmFirstFrame(node.id, selectedImageUrl!),
            )
          }
        >
          确认动作首帧
        </button>
      </div>
    )
  }
  if (node.phase === 'completed' && node.selectedFirstFrameUrl) {
    return (
      <div className={CARD_STACK}>
        <WorkflowImage src={node.selectedFirstFrameUrl} alt="已确认动作首帧" variant="master" />
        <div className="grid gap-2">
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={branchBusy}
            onClick={() =>
              input.runCommand(branchKey, () =>
                input.controller.regenerateFirstFrame(node.id, {
                  spriteWidth: input.project.spriteSize.width,
                  spriteHeight: input.project.spriteSize.height,
                  mode: 'regenerate',
                }),
              )
            }
          >
            重新生成动作首帧
          </button>
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={branchBusy}
            onClick={() => setRefining((active) => !active)}
          >
            微调动作首帧
          </button>
          {refining ? (
            <div className="grid gap-2">
              <textarea
                aria-label="动作首帧微调描述"
                rows={3}
                className="min-h-[64px] w-full resize-y rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised px-3 py-2.5 font-[inherit] text-[11px] leading-[1.55] text-[var(--color-app-ink)] focus:border-app-accent focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-app-accent-soft"
                value={adjustmentPrompt}
                disabled={branchBusy}
                onChange={(event) => setAdjustmentPrompt(event.target.value)}
              />
              <button
                type="button"
                className={CARD_BUTTON}
                disabled={branchBusy || !adjustmentPrompt.trim()}
                onClick={() => {
                  const prompt = adjustmentPrompt.trim()
                  if (!prompt) return
                  input.runCommand(
                    branchKey,
                    () =>
                      input.controller.regenerateFirstFrame(node.id, {
                        spriteWidth: input.project.spriteSize.width,
                        spriteHeight: input.project.spriteSize.height,
                        mode: 'refine',
                        adjustmentPrompt: prompt,
                      }),
                    () => {
                      setRefining(false)
                      setAdjustmentPrompt('')
                    },
                  )
                }}
              >
                提交动作首帧微调
              </button>
            </div>
          ) : null}
        </div>
        <NodeExportButton model={input.exportModels.get(node.input.outfitId)} />
      </div>
    )
  }
  return <StatusText node={node} input={input} />
}

function MethodContent({
  node,
  input,
}: {
  node: ActionGenerationMethodWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'completed') {
    return <p className={CARD_SUMMARY}>{node.method === '3d-to-2d' ? '三渲二' : '视频裁剪'}</p>
  }
  if (node.status !== 'active') return <StatusText node={node} input={input} />

  const firstFrameNode = findDependency(input.run, node, 'action-first-frame')
  const outfit = firstFrameNode
    ? input.character?.outfits.find((candidate) => candidate.id === firstFrameNode.input.outfitId)
    : null
  const render3dReady = Boolean(outfit?.model3dUrl)

  return (
    <div className={CARD_STACK}>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy}
        onClick={() =>
          input.runCommand(branchKey, () =>
            input.controller.selectActionGenerationMethod(node.id, 'video-cropping'),
          )
        }
      >
        视频裁剪
      </button>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy || !render3dReady}
        title={render3dReady ? undefined : RENDER3D_UNAVAILABLE_HINT}
        onClick={() =>
          input.runCommand(branchKey, () =>
            input.controller.selectActionGenerationMethod(node.id, '3d-to-2d'),
          )
        }
      >
        三渲二{render3dReady ? '' : ' · 需先建 3D 模型'}
      </button>
      {render3dReady ? null : <p className={CARD_TEXT}>{RENDER3D_UNAVAILABLE_HINT}</p>}
    </div>
  )
}

function AnimationContent({
  node,
  input,
}: {
  node: ActionFullFrameWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const result = input.generations[generationKey(node.id, 'complete_animation')]?.result
  const frames = result?.type === 'complete_animation' ? result.frames : []
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'ready' && node.status === 'active') {
    // 依赖链是 首帧 → 生产方式 → 完整动画，所以要往上翻两层才拿得到首帧的造型。
    const methodNode = findDependency(input.run, node, 'action-generation-method')
    const firstFrameNode = methodNode
      ? findDependency(input.run, methodNode, 'action-first-frame')
      : null
    const character = firstFrameNode
      ? characterOwningOutfit(input.character, firstFrameNode.input.outfitId)
      : null
    return (
      <button
        type="button"
        className={`${CARD_BUTTON} nodrag nopan nowheel`}
        disabled={!character || branchBusy}
        onClick={() => {
          if (!character) return
          input.runCommand(branchKey, () =>
            input.controller.generateCompleteAnimation(node.id, {
              characterId: character.id,
              referenceMedia: [],
            }),
          )
        }}
      >
        生成完整动画
      </button>
    )
  }
  if (node.phase === 'completed' && frames.length) {
    const methodNode = findDependency(input.run, node, 'action-generation-method')
    const firstFrameNode = methodNode
      ? findDependency(input.run, methodNode, 'action-first-frame')
      : null
    return (
      <div className={CARD_STACK}>
        <div className="nodrag nopan nowheel grid max-h-40 grid-cols-8 gap-[3px] overflow-auto">
          {frames.map((frame, index) => (
            <WorkflowImage
              key={`${frame.url}-${index}`}
              src={frame.url}
              alt={`动画帧 ${index + 1}`}
              variant="frame"
            />
          ))}
        </div>
        {firstFrameNode ? (
          <NodeExportButton model={input.exportModels.get(firstFrameNode.input.outfitId)} />
        ) : null}
      </div>
    )
  }
  return <StatusText node={node} input={input} />
}

function ReviewContent({ node, input }: { node: ReviewWorkflowNode; input: ProjectionInput }) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'completed') {
    const fullFrame = findDependency(input.run, node, 'action-full-frame')
    const method = fullFrame
      ? findDependency(input.run, fullFrame, 'action-generation-method')
      : null
    const firstFrame = method ? findDependency(input.run, method, 'action-first-frame') : null
    return (
      <div className={CARD_STACK}>
        <p className={CARD_SUMMARY}>审核已通过</p>
        {firstFrame ? (
          <NodeExportButton model={input.exportModels.get(firstFrame.input.outfitId)} />
        ) : null}
      </div>
    )
  }
  if (node.status !== 'active') return <StatusText node={node} input={input} />
  return (
    <div className={CARD_STACK}>
      <p className={CARD_TEXT}>确认完整动画后完成本动作审核。</p>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy}
        onClick={() =>
          input.runCommand(branchKey, async () => {
            const character = await input.publishReviewedAction(node.id)
            input.setCharacter(character)
          })
        }
      >
        审核通过
      </button>
    </div>
  )
}

function WorkflowCard({ data, selected }: NodeProps<WorkflowCardNode>) {
  return (
    <article
      aria-label={data.title}
      className={[
        'w-[296px] overflow-visible rounded-[10px] border bg-app-surface-raised/98 transition-[border-color,box-shadow,opacity] duration-150 ease-out',
        selected
          ? 'border-app-accent shadow-app-card'
          : 'border-app-line shadow-app-menu hover:border-app-line-strong',
        data.status === 'failed' ? 'border-dashed' : 'border-solid',
        data.status === 'locked' ? 'opacity-60' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <header className="workflow-card__handle flex min-h-[50px] cursor-grab select-none items-center gap-2 px-3.5 py-2.5 active:cursor-grabbing">
        <span className="font-mono text-[9px] font-bold leading-none text-app-muted">
          {data.eyebrow}
        </span>
        <strong className="text-[13px] font-semibold text-app-ink-soft">{data.title}</strong>
      </header>
      <div className="rounded-b-[9px] bg-app-surface-raised/98 px-3.5 pb-3.5 pt-1">
        {data.content}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </article>
  )
}

function StatusText({ node, input }: { node: WorkflowNode; input: ProjectionInput }) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const resumeBlocked =
    input.resumeBlocked && node.status === 'active' && node.phase === 'generating'
  if (node.status === 'failed' || resumeBlocked) {
    return (
      <div className={CARD_STACK}>
        <p className={CARD_SUMMARY}>
          {node.status === 'failed' ? (node.error ?? '生成失败') : '生成任务恢复失败'}
        </p>
        <button
          type="button"
          className={CARD_BUTTON}
          disabled={branchBusy}
          onClick={() => {
            input.setSelectedImages({})
            input.runCommand(branchKey, () => input.controller.restartFromNode(node.id))
          }}
        >
          从此节点重做
        </button>
      </div>
    )
  }
  const label =
    node.status === 'locked' ? '等待上游节点' : node.phase === 'generating' ? '生成中…' : '处理中…'
  if (node.phase === 'generating' || (node.status === 'active' && label === '处理中…')) {
    return (
      <p role="status" className={`${CARD_SUMMARY} flex items-center gap-2`}>
        <span className="workflow-status-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-app-accent" />
        {label}
      </p>
    )
  }
  return <p className={CARD_SUMMARY}>{label}</p>
}

function EditorBoundary({ message }: { message: string }) {
  return (
    <div className="grid min-h-screen place-content-center gap-2 bg-app-canvas text-center">
      <p className="m-0 text-[10px] font-extrabold tracking-[0.16em] text-app-muted">
        MANUAL WORKFLOW
      </p>
      <h1 className="m-0 text-3xl font-semibold">工作流编辑器</h1>
      <span className="m-0 text-[13px] text-app-muted">{message}</span>
    </div>
  )
}

/**
 * 一个节点可以同时挂多个角色的生成任务，所以字典的键必须带上角色，
 * 只用节点 ID 会让后读到的那条静默覆盖前一条。已删节点不再读取。
 */
function generationKey(nodeId: WorkflowNode['id'], role: WorkflowGenerationRole) {
  return `${nodeId}:${role}`
}

/**
 * 节点属于哪条动作分支：顺着依赖往上爬到本分支的首帧节点，用它的 ID 当分支标识。
 * 角色设定与身份母版为所有分支共用，爬不到首帧，归到 SHARED_BRANCH。
 */
function branchKeyFor(node: WorkflowNode, nodesById: ReadonlyMap<string, WorkflowNode>): string {
  let current: WorkflowNode | undefined = node
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.type === 'action-first-frame') return current.id
    current = current.dependsOnNodeIds
      .map((dependencyId) => nodesById.get(dependencyId))
      .find((dependency) => dependency?.type !== 'character-template')
  }
  return SHARED_BRANCH
}

/** 分支在画布上排第几行。共享节点与找不到根的节点都落在第 0 行。 */
function branchIndexFor(branchKey: string, actionRootIds: string[]): number {
  return Math.max(0, actionRootIds.indexOf(branchKey))
}

function positionFor(type: WorkflowNode['type'], branchIndex: number) {
  const x: Record<WorkflowNode['type'], number> = {
    'character-setup': 60,
    'character-template': 400,
    'action-first-frame': 740,
    'action-generation-method': 1080,
    'action-full-frame': 1420,
    review: 1760,
  }
  const isActionBranch = type.startsWith('action') || type === 'review'
  return {
    x: x[type],
    y: isActionBranch ? 48 + branchIndex * 380 : 218,
  }
}

/** 卡片抬头文案。序号是流程顺序，与 positionFor 的横向排布一致。 */
const CARD_LABELS: Record<WorkflowNode['type'], { eyebrow: string; title: string }> = {
  'character-setup': { eyebrow: '01', title: '角色设定' },
  'character-template': { eyebrow: '02', title: '身份母版' },
  'action-first-frame': { eyebrow: '03', title: '动作首帧' },
  'action-generation-method': { eyebrow: '04', title: '生产方式' },
  'action-full-frame': { eyebrow: '05', title: '完整动画' },
  review: { eyebrow: '06', title: '动画审核' },
}

/**
 * 造型属于当前角色时返回该角色，否则返回 null。
 * 一条 WorkflowRun 只绑定一个角色，所以这里不是查找，是归属校验。
 */
function characterOwningOutfit(character: Character | null, outfitId: string) {
  return character?.outfits.some((outfit) => outfit.id === outfitId) ? character : null
}

function findDependency<T extends WorkflowNode['type']>(
  run: WorkflowRun,
  node: WorkflowNode,
  type: T,
): Extract<WorkflowNode, { type: T }> | null {
  const dependencies = run.nodes.filter((candidate) => node.dependsOnNodeIds.includes(candidate.id))
  const match = dependencies.find((candidate) => candidate.type === type)
  return (match as Extract<WorkflowNode, { type: T }> | undefined) ?? null
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
