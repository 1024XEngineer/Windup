import {
  Controls,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  type ActionFirstFrameWorkflowNode,
  type ActionFullFrameWorkflowNode,
  type ActionGenerationMethodWorkflowNode,
  type Character,
  type CharacterSetupWorkflowNode,
  type CharacterTemplateWorkflowNode,
  type Generation,
  type Project,
  type ReviewWorkflowNode,
  type WorkflowNode,
  type WorkflowRun,
} from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'
import { createDefaultRealWorkflowEditorSession, type WorkflowEditorSession } from './runtime'
import './workflow-editor.css'

export interface WorkflowEditorPageProps {
  loadSession?: (runId: string) => Promise<WorkflowEditorSession>
}

type WorkflowCardData = {
  title: string
  eyebrow: string
  status: WorkflowNode['status']
  content: ReactNode
}

type WorkflowCardNode = Node<WorkflowCardData, 'workflow-card'>
type ActionMenuLevel = 'root' | 'outfits' | 'actions'

const nodeTypes = { 'workflow-card': WorkflowCard }

/**
 * 页面只订阅 Controller 的 WorkflowRun 并把它投影为画布；选择、菜单、位置和 busy
 * 都是临时 UI 状态，不会写出第二份流程状态机。
 */
export function WorkflowEditorPage({ loadSession }: WorkflowEditorPageProps = {}) {
  const { runId } = useParams<{ runId: string }>()
  const [session, setSession] = useState<WorkflowEditorSession | null>(null)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [generations, setGenerations] = useState<Record<string, Generation | null>>({})
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({})
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [actionMenuLevel, setActionMenuLevel] = useState<ActionMenuLevel>('root')
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [generationReadError, setGenerationReadError] = useState<string | null>(null)
  const [canvasNodes, setCanvasNodes] = useState<WorkflowCardNode[]>([])
  const sessionEpochRef = useRef(0)
  const generationReadEpochRef = useRef(0)

  const requestGenerations = useCallback(
    (targetSession: WorkflowEditorSession, targetRun: WorkflowRun, sessionEpoch: number) => {
      const readEpoch = generationReadEpochRef.current + 1
      generationReadEpochRef.current = readEpoch
      void readGenerations(targetSession.controller, targetRun)
        .then((results) => {
          if (
            sessionEpochRef.current === sessionEpoch &&
            generationReadEpochRef.current === readEpoch
          ) {
            setGenerations(results)
            setGenerationReadError(null)
          }
        })
        .catch((cause: unknown) => {
          if (
            sessionEpochRef.current === sessionEpoch &&
            generationReadEpochRef.current === readEpoch
          ) {
            setGenerationReadError(errorMessage(cause, '读取生成结果失败'))
          }
        })
    },
    [],
  )

  const runCommand = useCallback(
    (name: string, command: () => Promise<void>) => {
      if (busy) return
      const commandEpoch = sessionEpochRef.current
      setBusy(name)
      setError(null)
      void command()
        .catch((cause: unknown) => {
          if (sessionEpochRef.current === commandEpoch) {
            setError(errorMessage(cause, '工作流命令执行失败'))
          }
        })
        .finally(() => {
          if (sessionEpochRef.current === commandEpoch) setBusy(null)
        })
    },
    [busy],
  )

  useEffect(() => {
    const sessionEpoch = sessionEpochRef.current + 1
    sessionEpochRef.current = sessionEpoch
    generationReadEpochRef.current += 1
    setSession(null)
    setRun(null)
    setGenerations({})
    setSelectedImages({})
    setActionMenuOpen(false)
    setActionMenuLevel('root')
    setSelectedOutfitId(null)
    setBusy(null)
    setError(null)
    setResumeError(null)
    setGenerationReadError(null)
    setCanvasNodes([])
    if (!runId) return

    let active = true
    let loaded: WorkflowEditorSession | null = null
    let unsubscribe: () => void = () => undefined
    let unsubscribeErrors: () => void = () => undefined
    const loader = loadSession ?? defaultSessionLoader

    void loader(runId)
      .then(async (nextSession) => {
        if (!active || sessionEpochRef.current !== sessionEpoch) {
          nextSession.dispose()
          return
        }
        loaded = nextSession
        setSession(nextSession)
        unsubscribeErrors = nextSession.subscribeErrors((nextError) => {
          if (active && sessionEpochRef.current === sessionEpoch) {
            setError(errorMessage(nextError, '工作流异步处理失败'))
          }
        })
        unsubscribe = nextSession.controller.subscribe((nextRun) => {
          if (!active || sessionEpochRef.current !== sessionEpoch) return
          setRun(nextRun)
          requestGenerations(nextSession, nextRun, sessionEpoch)
        })
        try {
          await nextSession.controller.resume()
        } catch (cause: unknown) {
          if (active && sessionEpochRef.current === sessionEpoch) {
            setResumeError(errorMessage(cause, '恢复 WorkflowRun 失败'))
          }
        }
      })
      .catch((cause: unknown) => {
        if (active && sessionEpochRef.current === sessionEpoch) {
          setError(errorMessage(cause, '恢复 WorkflowRun 失败'))
        }
      })

    return () => {
      active = false
      generationReadEpochRef.current += 1
      unsubscribe()
      unsubscribeErrors()
      loaded?.dispose()
    }
  }, [loadSession, requestGenerations, runId])

  const projected = useMemo(
    () =>
      run && session
        ? projectCanvas({
            run,
            controller: session.controller,
            approveAndPublishReview: session.approveAndPublishReview,
            project: session.project,
            character: session.character,
            generations,
            selectedImages,
            actionMenuOpen,
            actionMenuLevel,
            selectedOutfitId,
            busy,
            resumeBlocked: Boolean(resumeError),
            setSelectedImages,
            setActionMenuOpen,
            setActionMenuLevel,
            setSelectedOutfitId,
            runCommand,
          })
        : { nodes: [] as WorkflowCardNode[], edges: [] as Edge[] },
    [
      actionMenuOpen,
      actionMenuLevel,
      busy,
      generations,
      run,
      runCommand,
      resumeError,
      selectedImages,
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

  useEffect(() => {
    if (
      resumeError &&
      run &&
      !run.nodes.some(
        (node) => !node.deletedAt && node.status === 'active' && node.phase === 'generating',
      )
    ) {
      setResumeError(null)
    }
  }, [resumeError, run])

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

  const constraints = [
    CHARACTER_PERSPECTIVE[session.project.perspective],
    DIRECTIONAL_MOVEMENT[session.project.directionalMovement],
    `${session.project.spriteSize.width} × ${session.project.spriteSize.height}`,
    session.project.gameStyle ?? '未设置画风',
  ]
  const visibleError = error ?? resumeError ?? generationReadError

  return (
    <main className="workflow-editor-shell">
      <aside className="workflow-editor-project" aria-label="当前项目">
        <div>
          <p>PROJECT</p>
          <h1>{session.project.name}</h1>
        </div>
        <p className="workflow-editor-project__constraints">{constraints.join(' · ')}</p>
        <div className="workflow-editor-contract">
          <span className="is-real">真实 WorkflowRun 接口</span>
          <small>
            Run {run.id} · v{run.version}
          </small>
        </div>
      </aside>
      {visibleError ? (
        <div className="workflow-editor-error" role="alert">
          <span>{visibleError}</span>
          {!error && !resumeError && generationReadError ? (
            <button
              type="button"
              onClick={() => requestGenerations(session, run, sessionEpochRef.current)}
            >
              重试读取生成结果
            </button>
          ) : null}
        </div>
      ) : null}
      <section className="workflow-editor-canvas" aria-label="WorkflowRun 画布">
        <ReactFlow<WorkflowCardNode>
          nodes={canvasNodes}
          edges={projected.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.14, maxZoom: 0.82 }}
          minZoom={0.3}
          maxZoom={1.2}
        >
          <FitViewOnChange
            signature={`${run.version}:${actionMenuOpen}:${Object.keys(generations).join(',')}:${canvasNodes.length}`}
          />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </section>
    </main>
  )
}

function FitViewOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.14, maxZoom: 0.82, duration: 180 })
    }, 32)
    return () => window.clearTimeout(timer)
  }, [fitView, signature])
  return null
}

interface ProjectionInput {
  run: WorkflowRun
  controller: WorkflowController
  approveAndPublishReview(reviewNodeId: ReviewWorkflowNode['id']): Promise<void>
  project: Project
  character: Character | null
  generations: Record<string, Generation | null>
  selectedImages: Record<string, string>
  actionMenuOpen: boolean
  actionMenuLevel: ActionMenuLevel
  selectedOutfitId: string | null
  busy: string | null
  resumeBlocked: boolean
  setSelectedImages: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setActionMenuOpen(open: boolean): void
  setActionMenuLevel(level: ActionMenuLevel): void
  setSelectedOutfitId(outfitId: string | null): void
  runCommand(name: string, command: () => Promise<void>): void
}

function projectCanvas(input: ProjectionInput): { nodes: WorkflowCardNode[]; edges: Edge[] } {
  const activeNodes = input.run.nodes.filter((node) => !node.deletedAt)
  const actionRootIds = activeNodes
    .filter((node) => node.type === 'action-first-frame')
    .map((node) => node.id)
  const nodes = activeNodes.map((node) =>
    toCanvasNode(node, branchIndexFor(node, activeNodes, actionRootIds), input),
  )
  const edges: Edge[] = activeNodes.flatMap((node) => {
    const confirmed = node.status === 'passed'
    return node.dependsOnNodeIds.map((source) => ({
      id: `${source}->${node.id}`,
      source,
      target: node.id,
      selectable: false,
      deletable: false,
      type: 'default',
      animated: false,
      className: confirmed ? undefined : 'workflow-edge--flowing',
      style: {
        stroke: confirmed ? '#69866f' : 'rgba(72, 101, 80, 0.42)',
        strokeWidth: 3,
        strokeDasharray: confirmed ? undefined : '9 8',
      },
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
      eyebrow: eyebrowFor(node.type),
      title: titleFor(node.type),
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
  const [prompt, setPrompt] = useState(node.input.prompt)
  useEffect(() => setPrompt(node.input.prompt), [node.id, node.input.prompt])

  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.status === 'passed') return <p className="workflow-card__summary">角色描述已确认</p>
  return (
    <div className="workflow-card__stack nodrag nopan nowheel">
      <label className="workflow-card__field">
        <span>角色描述</span>
        <textarea
          aria-label="角色描述"
          rows={4}
          value={prompt}
          disabled={Boolean(input.busy)}
          onChange={(event) => setPrompt(event.target.value)}
        />
        {node.input.referenceMedia.length > 0 ? (
          <small>已关联 {node.input.referenceMedia.length} 个参考媒体</small>
        ) : null}
      </label>
      <button
        type="button"
        disabled={Boolean(input.busy) || !prompt.trim()}
        onClick={() =>
          input.runCommand('character-template', () =>
            getController(input).generateCharacterTemplate(node.id, {
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
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'ready' && node.status === 'active') {
    const setupNode = findDependency(input.run, node, 'character-setup')
    return (
      <button
        type="button"
        className="nodrag nopan nowheel"
        disabled={!setupNode || Boolean(input.busy)}
        onClick={() => {
          if (!setupNode) return
          input.runCommand('character-template', () =>
            getController(input).generateCharacterTemplate(setupNode.id, {
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
    const result = input.generations[node.id]?.result
    const images = result?.type === 'character_template' ? result.images : []
    const selectedImageUrl =
      images.find((image) => image.url === input.selectedImages[node.id])?.url ?? null
    return (
      <div className="workflow-card__stack nodrag nopan nowheel">
        <div className="workflow-candidate-grid">
          {images.map((image, index) => (
            <button
              type="button"
              key={image.url}
              aria-label={`选择角色候选 ${index + 1}`}
              aria-pressed={selectedImageUrl === image.url}
              onClick={() =>
                input.setSelectedImages((selected) => ({ ...selected, [node.id]: image.url }))
              }
            >
              <img src={image.url} alt={`角色候选 ${index + 1}`} />
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!selectedImageUrl || Boolean(input.busy)}
          onClick={() =>
            input.runCommand('confirm-template', () =>
              getController(input).confirmCharacterTemplate(node.id, selectedImageUrl!),
            )
          }
        >
          确认身份母版
        </button>
      </div>
    )
  }
  if (node.status === 'passed' && node.selectedImageUrl) {
    return (
      <div className="workflow-card__stack nodrag nopan nowheel">
        <img className="workflow-master-image" src={node.selectedImageUrl} alt="已确认身份母版" />
        <span className="workflow-lock">身份已锁定</span>
        <button
          type="button"
          className="workflow-card__plus"
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
          <div className="workflow-card__plus-menu">
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
  const presets = [
    {
      type: 'idle',
      name: 'Idle 待机',
      hint: '预设动作 · 逐帧生成',
      prompt: '平稳呼吸，重心轻微起伏',
    },
    {
      type: 'walk',
      name: 'Walk 行走',
      hint: '预设动作 · 逐帧生成',
      prompt: '轻快地向前行走',
    },
    {
      type: 'attack',
      name: 'Attack 攻击',
      hint: '预设动作 · 逐帧生成',
      prompt: '蓄力后向前攻击并回到准备姿态',
    },
  ] as const

  if (input.actionMenuLevel === 'root') {
    return (
      <div className="workflow-action-menu">
        <button
          type="button"
          disabled={outfits.length === 0 || Boolean(input.busy)}
          onClick={() => {
            if (outfits.length === 1) {
              input.setSelectedOutfitId(outfits[0]!.id)
              input.setActionMenuLevel('actions')
              return
            }
            input.setActionMenuLevel('outfits')
          }}
        >
          <b>生成动作 ›</b>
        </button>
        <button type="button" disabled>
          <b>生成静态资产</b>
          <small>本期不做，需单独提案</small>
        </button>
        <button type="button" disabled>
          <b>导出</b>
          <small>完成审核后打包动作</small>
        </button>
      </div>
    )
  }

  if (input.actionMenuLevel === 'outfits') {
    return (
      <div className="workflow-action-menu">
        <button type="button" onClick={() => input.setActionMenuLevel('root')}>
          ← 选择造型
        </button>
        {outfits.map((outfit) => (
          <button
            type="button"
            key={outfit.id}
            aria-label={`选择造型 ${outfit.name}`}
            onClick={() => {
              input.setSelectedOutfitId(outfit.id)
              input.setActionMenuLevel('actions')
            }}
          >
            <b>{outfit.name}</b>
            <small>{outfit.description ?? '使用此造型生成动作'}</small>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="workflow-action-menu">
      <button
        type="button"
        onClick={() => input.setActionMenuLevel(outfits.length > 1 ? 'outfits' : 'root')}
      >
        ← 生成动作
      </button>
      {presets.map((preset) => (
        <button
          type="button"
          key={preset.type}
          disabled={!selectedOutfit || Boolean(input.busy)}
          onClick={() => {
            if (!selectedOutfit) return
            input.runCommand('add-action', () =>
              getController(input).addAction({
                dependsOnNodeIds: [templateNodeId],
                input: {
                  outfitId: selectedOutfit.id,
                  name: preset.name.replace(/^[A-Za-z]+\s+/, ''),
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
          <b>{preset.name}</b>
          <small>{preset.hint}</small>
        </button>
      ))}
      <button type="button" disabled title="当前页面尚未提供动作描述输入">
        <b>自定义动作</b>
        <small>描述输入尚未开放</small>
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
  const result = input.generations[node.id]?.result
  const image = result?.type === 'first_frame' ? result.image : null
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'configuring') {
    const character = findCharacterForOutfit(input.character, node.input.outfitId)
    return (
      <div className="workflow-card__stack nodrag nopan nowheel">
        <p>
          {node.input.name} · {node.input.fps} FPS
        </p>
        <p>{node.input.prompt ?? '无额外动作描述'}</p>
        <button
          type="button"
          disabled={!character || Boolean(input.busy)}
          onClick={() => {
            if (!character) return
            input.runCommand('first-frame', () =>
              getController(input).generateFirstFrame(node.id, {
                characterId: character.id,
                referenceMedia: [],
              }),
            )
          }}
        >
          生成动作首帧
        </button>
      </div>
    )
  }
  if (node.phase === 'selecting' && image) {
    const selectedImageUrl = input.selectedImages[node.id] === image.url ? image.url : null
    return (
      <div className="workflow-card__stack nodrag nopan nowheel">
        <button
          type="button"
          className="workflow-first-frame"
          aria-label="选择动作首帧"
          aria-pressed={selectedImageUrl === image.url}
          onClick={() =>
            input.setSelectedImages((selected) => ({ ...selected, [node.id]: image.url }))
          }
        >
          <img src={image.url} alt="动作首帧候选" />
        </button>
        <button
          type="button"
          disabled={!selectedImageUrl || Boolean(input.busy)}
          onClick={() =>
            input.runCommand('confirm-first-frame', () =>
              getController(input).confirmFirstFrame(node.id, selectedImageUrl!),
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
      <img
        className="workflow-master-image"
        src={node.selectedFirstFrameUrl}
        alt="已确认动作首帧"
      />
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
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'completed') return <p className="workflow-card__summary">视频裁剪</p>
  if (node.status !== 'active') return <StatusText node={node} input={input} />
  return (
    <div className="workflow-card__stack nodrag nopan nowheel">
      <button
        type="button"
        disabled={Boolean(input.busy)}
        onClick={() =>
          input.runCommand('select-method', () =>
            getController(input).selectActionGenerationMethod(node.id, 'video-cropping'),
          )
        }
      >
        视频裁剪
      </button>
      <button type="button" disabled title="后端接口尚未提供">
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
  const result = input.generations[node.id]?.result
  const frames = result?.type === 'complete_animation' ? result.frames : []
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'ready' && node.status === 'active') {
    const firstFrame = findDependency(input.run, node, 'action-generation-method')
    const actionNode = firstFrame
      ? findDependency(input.run, firstFrame, 'action-first-frame')
      : null
    const character =
      actionNode?.type === 'action-first-frame'
        ? findCharacterForOutfit(input.character, actionNode.input.outfitId)
        : null
    return (
      <button
        type="button"
        className="nodrag nopan nowheel"
        disabled={!character || Boolean(input.busy)}
        onClick={() => {
          if (!character) return
          input.runCommand('complete-animation', () =>
            getController(input).generateCompleteAnimation(node.id, {
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
    return (
      <div className="workflow-frame-strip nodrag nopan nowheel">
        {frames.map((frame, index) => (
          <img key={`${frame.url}-${index}`} src={frame.url} alt={`动画帧 ${index + 1}`} />
        ))}
      </div>
    )
  }
  return <StatusText node={node} input={input} />
}

function ReviewContent({ node, input }: { node: ReviewWorkflowNode; input: ProjectionInput }) {
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'completed') return <p className="workflow-card__summary">审核已通过</p>
  if (node.status !== 'active') return <StatusText node={node} input={input} />
  return (
    <div className="workflow-card__stack nodrag nopan nowheel">
      <p>确认完整动画后完成本动作审核。</p>
      <button
        type="button"
        disabled={Boolean(input.busy)}
        onClick={() =>
          input.runCommand('approve-review', () => input.approveAndPublishReview(node.id))
        }
      >
        审核通过
      </button>
    </div>
  )
}

function WorkflowCard({ data }: NodeProps<WorkflowCardNode>) {
  return (
    <article className={`workflow-card is-${data.status}`}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        isConnectableStart={false}
        isConnectableEnd={false}
      />
      <header className="workflow-card__handle">
        <span>{data.eyebrow}</span>
        <strong>{data.title}</strong>
      </header>
      <div className="workflow-card__body">{data.content}</div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        isConnectableStart={false}
        isConnectableEnd={false}
      />
    </article>
  )
}

function StatusText({ node, input }: { node: WorkflowNode; input: ProjectionInput }) {
  const resumeBlocked =
    input.resumeBlocked && node.status === 'active' && node.phase === 'generating'
  if (node.status === 'failed' || resumeBlocked) {
    return (
      <div className="workflow-card__stack nodrag nopan nowheel">
        <p className="workflow-card__summary">
          {node.status === 'failed' ? (node.error ?? '生成失败') : '生成任务恢复失败'}
        </p>
        <button
          type="button"
          disabled={Boolean(input.busy)}
          onClick={() => {
            input.setSelectedImages({})
            input.runCommand('restart-node', () => getController(input).restartFromNode(node.id))
          }}
        >
          从此节点重做
        </button>
      </div>
    )
  }
  const label =
    node.status === 'locked' ? '等待上游节点' : node.phase === 'generating' ? '生成中…' : '处理中…'
  return <p className="workflow-card__summary">{label}</p>
}

function EditorBoundary({ message }: { message: string }) {
  return (
    <main className="workflow-editor-boundary">
      <p>MANUAL WORKFLOW</p>
      <h1>工作流编辑器</h1>
      <span>{message}</span>
    </main>
  )
}

async function readGenerations(
  controller: WorkflowController,
  run: WorkflowRun,
): Promise<Record<string, Generation | null>> {
  const entries = await Promise.all(
    run.nodes.flatMap((node) =>
      node.generations.map(
        async (reference) =>
          [node.id, await controller.getGeneration(node.id, reference.role)] as const,
      ),
    ),
  )
  return Object.fromEntries(entries)
}

function getController(input: ProjectionInput): WorkflowController {
  return input.controller
}

function branchIndexFor(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  actionRootIds: string[],
): number {
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  let current: WorkflowNode | undefined = node
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.type === 'action-first-frame') {
      return Math.max(0, actionRootIds.indexOf(current.id))
    }
    current = current.dependsOnNodeIds
      .map((dependencyId) => nodesById.get(dependencyId))
      .find((dependency) => dependency?.type !== 'character-template')
  }
  return 0
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

function titleFor(type: WorkflowNode['type']) {
  return {
    'character-setup': '角色设定',
    'character-template': '身份母版',
    'action-first-frame': '动作首帧',
    'action-generation-method': '生产方式',
    'action-full-frame': '完整动画',
    review: '动画审核',
  }[type]
}

function eyebrowFor(type: WorkflowNode['type']) {
  return {
    'character-setup': '01 · ORIGIN',
    'character-template': '02 · MASTER',
    'action-first-frame': '03 · FIRST FRAME',
    'action-generation-method': '04 · METHOD',
    'action-full-frame': '05 · ANIMATION',
    review: '06 · REVIEW',
  }[type]
}

function findCharacterForOutfit(character: Character | null, outfitId: string) {
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

async function defaultSessionLoader(runId: string) {
  return createDefaultRealWorkflowEditorSession(runId)
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
