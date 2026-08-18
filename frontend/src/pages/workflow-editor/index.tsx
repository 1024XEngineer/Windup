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
  type ActionFirstFrameWorkflowNode,
  type ActionFullFrameWorkflowNode,
  type ActionGenerationMethodWorkflowNode,
  type Character,
  type CharacterSetupWorkflowNode,
  type CharacterTemplateWorkflowNode,
  type Generation,
  type MediaReference,
  type Project,
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
import type { WorkflowEditorSession } from './runtime'
import { useWorkflowEditorSession } from './use-workflow-editor-session'
import { WorkflowEditorView, type WorkflowCardNode } from './workflow-editor-view'
import './workflow-editor.css'

export interface WorkflowEditorPageProps {
  loadSession?: (runId: string) => Promise<WorkflowEditorSession>
}

type ActionMenuLevel = 'root' | 'outfits' | 'actions'

/**
 * 菜单里的预设动作。label 只用于展示，name 是落进 WorkflowRun 的动作名——
 * 两者分开写，改菜单文案不会连带改掉已经落库的数据。
 */
const ACTION_PRESETS = [
  {
    type: 'idle',
    label: 'Idle 待机',
    name: '待机',
    prompt: '平稳呼吸，重心轻微起伏',
  },
  { type: 'walk', label: 'Walk 行走', name: '行走', prompt: '轻快地向前行走' },
  {
    type: 'attack',
    label: 'Attack 攻击',
    name: '攻击',
    prompt: '蓄力后向前攻击并回到准备姿态',
  },
] as const

const ACTION_PRESET_HINT = '预设动作 · 逐帧生成'

/** 角色设定与身份母版为所有动作分支共用，归在这条虚拟分支下。 */
const SHARED_BRANCH = 'shared'

/*
  卡片内部复用三次以上的样式串。原来靠 .workflow-card button 这类后代选择器统一施加，
  搬成工具类后写在这里，好处是能看见哪些元素共用同一套外观，而不是被选择器隐式波及。
  nodrag/nopan/nowheel 是 React Flow 的约定类：让卡片内的交互不被画布手势吞掉。
*/
const CARD_STACK = 'grid gap-[17px] nodrag nopan nowheel'

const CARD_BUTTON =
  'min-h-[42px] rounded-lg border border-app-accent bg-app-accent px-3 py-[9px] text-[11px] ' +
  'font-[750] text-app-on-accent enabled:hover:border-app-accent-hover enabled:hover:bg-app-accent-hover ' +
  'aria-pressed:border-app-accent-hover aria-pressed:bg-app-accent-hover disabled:cursor-not-allowed ' +
  'disabled:border-app-line disabled:bg-app-surface-muted disabled:text-app-faint'

/** 缩略图按钮：沿用卡片按钮的尺寸约定，但换成浅底，让图片自己当主角。 */
const THUMB_BUTTON =
  'min-h-[42px] rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised p-1 ' +
  'aria-pressed:border-[var(--color-app-ink)] aria-pressed:bg-app-surface-raised ' +
  'aria-pressed:shadow-app-pulse disabled:cursor-not-allowed'

const THUMB_IMAGE = 'block aspect-square w-full rounded-lg object-cover'

/** 已确认的母版/首帧：像素资产按原样放大，不做平滑。 */
const MASTER_IMAGE =
  'block aspect-square w-full rounded-xl border border-[var(--color-app-line)] bg-app-surface ' +
  'object-cover [image-rendering:pixelated]'

const CARD_SUMMARY =
  'm-0 rounded-[10px] border border-[var(--color-app-line)] bg-app-surface px-3 py-2.5 ' +
  'text-[11px] leading-[1.6] text-[var(--color-app-muted)]'

const CARD_TEXT = 'm-0 text-[11px] leading-[1.6] text-[var(--color-app-muted)]'

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
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [actionMenuLevel, setActionMenuLevel] = useState<ActionMenuLevel>('root')
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(null)
  const [canvasNodes, setCanvasNodes] = useState<WorkflowCardNode[]>([])

  useEffect(() => {
    setSelectedImages({})
    setSetupPromptDrafts({})
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
            character,
            generations,
            exportModels,
            selectedImages,
            setupPromptDrafts,
            actionMenuOpen,
            actionMenuLevel,
            selectedOutfitId,
            busyBranches,
            resumeBlocked: Boolean(resumeError),
            setSelectedImages,
            setSetupPromptDrafts,
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
  generations: Record<string, Generation | null>
  exportModels: ReadonlyMap<string, ExportPackageModel>
  selectedImages: Record<string, string>
  setupPromptDrafts: Record<string, string>
  actionMenuOpen: boolean
  actionMenuLevel: ActionMenuLevel
  selectedOutfitId: string | null
  busyBranches: ReadonlySet<string>
  resumeBlocked: boolean
  setSelectedImages: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setSetupPromptDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setActionMenuOpen(open: boolean): void
  setActionMenuLevel(level: ActionMenuLevel): void
  setSelectedOutfitId(outfitId: string | null): void
  setCharacter(character: Character): void
  runCommand(branchKey: string, command: () => Promise<void>): void
}

function NodeExportButton({ model }: { model: ExportPackageModel | undefined }) {
  return model ? (
    <ExportButton model={model} className={`${CARD_BUTTON} nodrag nopan nowheel`} />
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
              <img className={THUMB_IMAGE} src={image.url} alt={`角色候选 ${index + 1}`} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className={CARD_BUTTON}
          disabled={!selectedImageUrl || branchBusy}
          onClick={() =>
            input.runCommand(branchKey, async () => {
              const character = await input.confirmCharacterTemplate(node.id, selectedImageUrl!)
              input.setCharacter(character)
            })
          }
        >
          确认身份母版
        </button>
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
        <img className={MASTER_IMAGE} src={node.selectedImageUrl} alt="已确认身份母版" />
        <span className="text-center text-[11px] text-[var(--color-app-muted)]">身份已锁定</span>
        {outfit ? <NodeExportButton model={input.exportModels.get(outfit.id)} /> : null}
        <button
          type="button"
          className="absolute -bottom-4 -right-4 z-8 grid h-8 min-h-8 w-8 place-items-center rounded-full border border-[var(--color-app-ink)] bg-app-surface-raised p-0 text-[15px] leading-none text-[var(--color-app-ink)] shadow-[var(--shadow-app-panel)] hover:bg-[var(--color-app-ink)] hover:text-app-on-accent"
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

  return (
    <div className="contents">
      <button
        type="button"
        className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
        onClick={() => input.setActionMenuLevel(outfits.length > 1 ? 'outfits' : 'root')}
      >
        ← 生成动作
      </button>
      {ACTION_PRESETS.map((preset) => (
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
                  prompt: preset.prompt,
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
      ))}
      <button type="button" className={MENU_ITEM} disabled title="当前页面尚未提供动作描述输入">
        <b className={MENU_ITEM_TITLE}>自定义动作</b>
        <small className={MENU_ITEM_HINT}>描述输入尚未开放</small>
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
              <img className={THUMB_IMAGE} src={image.url} alt={`动作首帧候选 ${index + 1}`} />
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
        <img className={MASTER_IMAGE} src={node.selectedFirstFrameUrl} alt="已确认动作首帧" />
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
  if (node.phase === 'completed') return <p className={CARD_SUMMARY}>视频裁剪</p>
  if (node.status !== 'active') return <StatusText node={node} input={input} />
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
      <button type="button" className={CARD_BUTTON} disabled title="后端接口尚未提供">
        3D 转 2D · 尚未开放
      </button>
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
            <img
              key={`${frame.url}-${index}`}
              className="block aspect-square w-full rounded border border-[var(--color-app-line)] object-cover"
              src={frame.url}
              alt={`动画帧 ${index + 1}`}
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

function WorkflowCard({ data }: NodeProps<WorkflowCardNode>) {
  return (
    <article
      className={[
        'w-[368px] overflow-visible rounded-xl border border-[var(--color-app-line)] bg-app-surface-raised/98 shadow-[var(--shadow-app-panel)]',
        data.status === 'failed' ? 'border-dashed' : 'border-solid',
        data.status === 'locked' ? 'opacity-45' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <header className="workflow-card__handle grid min-h-[62px] cursor-grab select-none content-center gap-0.5 rounded-t-[11px] bg-app-accent px-[18px] py-3 text-app-on-accent active:cursor-grabbing">
        <span className="text-[8px] font-extrabold tracking-[0.12em] text-app-line">
          {data.eyebrow}
        </span>
        <strong className="text-sm font-bold">{data.title}</strong>
      </header>
      <div className="rounded-b-[11px] bg-app-surface-raised/98 p-[21px]">{data.content}</div>
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
    'character-setup': 70,
    'character-template': 510,
    'action-first-frame': 950,
    'action-generation-method': 1390,
    'action-full-frame': 1820,
    review: 2250,
  }
  const isActionBranch = type.startsWith('action') || type === 'review'
  return {
    x: x[type],
    y: isActionBranch ? 60 + branchIndex * 510 : 280,
  }
}

/** 卡片抬头文案。序号是流程顺序，与 positionFor 的横向排布一致。 */
const CARD_LABELS: Record<WorkflowNode['type'], { eyebrow: string; title: string }> = {
  'character-setup': { eyebrow: '01 · ORIGIN', title: '角色设定' },
  'character-template': { eyebrow: '02 · MASTER', title: '身份母版' },
  'action-first-frame': { eyebrow: '03 · FIRST FRAME', title: '动作首帧' },
  'action-generation-method': { eyebrow: '04 · METHOD', title: '生产方式' },
  'action-full-frame': { eyebrow: '05 · ANIMATION', title: '完整动画' },
  review: { eyebrow: '06 · REVIEW', title: '动画审核' },
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
