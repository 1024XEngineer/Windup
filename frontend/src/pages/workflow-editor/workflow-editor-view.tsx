import {
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
  useReactFlow,
} from '@xyflow/react'
import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  type Project,
  type WorkflowNode,
  type WorkflowRun,
} from '@/entities'

export type WorkflowCardData = {
  title: string
  eyebrow: string
  status: WorkflowNode['status']
  content: ReactNode
}

export type WorkflowCardNode = Node<WorkflowCardData, 'workflow-card'>

interface WorkflowEditorViewProps {
  project: Project
  run: WorkflowRun
  nodes: WorkflowCardNode[]
  edges: Edge[]
  nodeTypes: NodeTypes
  error: string | null
  workflowConflict: boolean
  generationReadError: string | null
  reloadTo: string
  onRetryGenerations(): void
  onNodesChange(changes: NodeChange<WorkflowCardNode>[]): void
}

export function WorkflowEditorView({
  project,
  run,
  nodes,
  edges,
  nodeTypes,
  error,
  workflowConflict,
  generationReadError,
  reloadTo,
  onRetryGenerations,
  onNodesChange,
}: WorkflowEditorViewProps) {
  const constraints = [
    CHARACTER_PERSPECTIVE[project.perspective],
    DIRECTIONAL_MOVEMENT[project.directionalMovement],
    `${project.spriteSize.width} × ${project.spriteSize.height}`,
    project.gameStyle ?? '未设置画风',
  ]

  return (
    <div className="workflow-editor-shell fixed inset-0 z-30 overflow-hidden bg-[var(--color-app-canvas)] text-[var(--color-app-ink)]">
      <aside
        className="pointer-events-none absolute bottom-4 left-4 z-15 grid min-w-[220px] max-w-[min(340px,calc(100vw-104px))] gap-1 rounded-lg border border-app-line bg-app-surface-raised/92 px-3.5 py-3 shadow-app-menu backdrop-blur-xl"
        aria-label="当前项目"
      >
        <div>
          <p className="m-0 mb-1 text-[9px] font-semibold text-app-muted">当前项目</p>
          <h1 className="m-0 text-sm font-bold text-app-ink-soft">{project.name}</h1>
        </div>
        <p className="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[9px] leading-[1.5] text-app-faint">
          {constraints.join(' / ')}
        </p>
        <div className="mt-1 flex justify-end">
          <small className="font-mono text-[8px] font-bold text-[var(--color-app-muted)]">
            Run {run.id} · v{run.version}
          </small>
        </div>
      </aside>
      {error ? (
        <div
          className="absolute left-1/2 top-[150px] z-10 flex -translate-x-1/2 items-center gap-3 border border-app-danger-line bg-app-danger-soft px-[14px] py-2.5 text-xs text-app-danger"
          role="alert"
        >
          <span>{error}</span>
          {workflowConflict ? (
            <Link
              reloadDocument
              to={reloadTo}
              className="rounded-md border border-current bg-transparent px-2 py-[5px] font-bold text-inherit"
            >
              加载最新版本
            </Link>
          ) : null}
          {generationReadError ? (
            <button
              type="button"
              className="rounded-md border border-current bg-transparent px-2 py-[5px] font-bold text-inherit"
              onClick={onRetryGenerations}
            >
              重试读取生成结果
            </button>
          ) : null}
        </div>
      ) : null}
      <section className="workflow-editor-canvas absolute inset-0" aria-label="WorkflowRun 画布">
        <ReactFlow<WorkflowCardNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 0.92 }}
          minZoom={0.3}
          maxZoom={1.2}
        >
          <FitViewOnNodeSetChange nodeIds={nodes.map((node) => node.id)} />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </section>
    </div>
  )
}

function FitViewOnNodeSetChange({ nodeIds }: { nodeIds: string[] }) {
  const { fitView } = useReactFlow()
  const signature = nodeIds.join(',')
  useEffect(() => {
    if (!signature) return
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.16, maxZoom: 0.92, duration: 180 })
    }, 32)
    return () => window.clearTimeout(timer)
  }, [fitView, signature])
  return null
}
