import {
  WORKFLOW_NODE_ORDER,
  type CharacterSetupNodeInput,
  type CharacterImageGenerationInput,
  type CharacterActionGenerationInput,
  type CharacterActionOutput,
  type CreateWorkflowRunInput,
  type MediaReference,
  type WorkflowRun,
  type WorkflowNode,
  type WorkflowNodeStatus,
  type WorkflowNodeType,
} from '@/entities'

export type CreateWorkflowRunStateInput = CreateWorkflowRunInput

export interface CreateWorkflowRunStateOptions {
  runId: WorkflowRun['id']
  createdAt: string
}

export interface WorkflowNodeTarget {
  runId: WorkflowRun['id']
  nodeId: WorkflowNode['id']
}

export function createWorkflowRunState(
  input: CreateWorkflowRunStateInput,
  { runId, createdAt }: CreateWorkflowRunStateOptions,
): WorkflowRun {
  const prompt = input.prompt?.trim() || null
  const nodes = createInitialNodes(input, runId, prompt)

  return {
    id: runId,
    projectId: input.projectId,
    characterId: input.purpose === 'add_action' ? input.characterId : null,
    outfitId: input.purpose === 'add_action' ? input.outfitId : null,
    purpose: input.purpose,
    status: 'active',
    nodes,
    generationStatus: 'not_started',
    exportStatus: 'not_exported',
    prompt,
    createdAt,
  }
}

function createInitialNodes(
  input: CreateWorkflowRunStateInput,
  runId: string,
  prompt: string | null,
): WorkflowNode[] {
  const nodes = WORKFLOW_NODE_ORDER.map((type, index) =>
    createInitialNode(type, runId, index, prompt),
  )
  if (input.purpose === 'create_character') return nodes

  return nodes.map((node) => {
    if (node.type === 'character-setup') {
      return {
        ...node,
        status: 'passed' as const,
        input: {
          description: prompt ?? '为已有角色添加动作',
          referenceMedia: [],
        },
      }
    }
    if (node.type === 'character-template') {
      return {
        ...node,
        status: 'passed' as const,
        output: {
          type: 'character_image' as const,
          imageUrls: [input.characterTemplateUrl],
        },
      }
    }
    if (node.type === 'action-first-frame') {
      return { ...node, status: 'passed' as const }
    }
    if (node.type === 'action-full-frame') {
      return { ...node, status: 'active' as const }
    }
    return node
  })
}

export function getCurrentRevision(run: WorkflowRun): WorkflowRun {
  return run
}

export function getActiveNode(run: WorkflowRun): WorkflowNode | null {
  return run.nodes.find((node) => node.status === 'active') ?? null
}

export function requireActiveWorkflow(run: WorkflowRun): WorkflowRun {
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可推进：${run.status}`)
  return run
}

export function replaceWorkflowNode(
  run: WorkflowRun,
  nodeId: WorkflowNode['id'],
  update: (node: WorkflowNode) => WorkflowNode,
): WorkflowRun {
  return {
    ...run,
    nodes: run.nodes.map((node) => (node.id === nodeId ? update(node) : node)),
  }
}

export function updateCharacterSetupState(
  workflow: WorkflowRun,
  input: CharacterSetupNodeInput,
): WorkflowRun {
  const run = requireActiveWorkflow(workflow)
  const node = run.nodes.find((item) => item.type === 'character-setup')
  if (!node || node.type !== 'character-setup' || node.status !== 'active') {
    throw new Error('当前只能更新处于 active 状态的角色资料节点')
  }

  const description = input.description.trim()
  if (!description) throw new Error('角色描述不能为空')

  return replaceWorkflowNode(run, node.id, (current) => {
    if (current.type !== 'character-setup') return current
    return {
      ...current,
      input: {
        description,
        referenceMedia: [...input.referenceMedia],
      },
    }
  })
}

export function acceptUploadedCharacterTemplateState(
  workflow: WorkflowRun,
  templateUrl: MediaReference,
): WorkflowRun {
  const run = requireActiveWorkflow(workflow)
  const activeNode = getActiveNode(run)
  if (!activeNode || activeNode.type !== 'character-setup') {
    throw new Error('当前只能在角色资料节点采用上传母版')
  }

  const normalizedUrl = String(templateUrl).trim()
  if (!normalizedUrl) throw new Error('上传角色母版引用不能为空')

  return {
    ...run,
    nodes: run.nodes.map((node) => {
      if (node.type === 'character-setup') {
        return {
          ...node,
          status: 'passed' as const,
          input: {
            description: '使用上传角色母版',
            referenceMedia: [normalizedUrl as MediaReference],
          },
        }
      }
      if (node.type === 'character-template') {
        return {
          ...node,
          status: 'passed' as const,
          input: null,
          output: {
            type: 'character_image' as const,
            imageUrls: [normalizedUrl],
          },
        }
      }
      if (node.type === 'action-first-frame') {
        return { ...node, status: 'passed' as const }
      }
      if (node.type === 'action-full-frame') {
        return { ...node, status: 'active' as const }
      }
      return node
    }),
  }
}

export function advanceCharacterSetupState(
  workflow: WorkflowRun,
  spriteSize: { width: number; height: number },
): {
  run: WorkflowRun
  target: WorkflowNodeTarget
} {
  const run = requireActiveWorkflow(workflow)
  const activeNode = getActiveNode(run)
  if (!activeNode) throw new Error('当前 WorkflowRun 没有 active 节点')
  if (activeNode.type !== 'character-setup') {
    throw new Error(`当前节点不是角色资料：${activeNode.type}`)
  }
  if (!activeNode.input) throw new Error('请先填写角色资料')

  const templateNode = run.nodes.find((node) => node.type === 'character-template')
  if (!templateNode) throw new Error('WorkflowRun 缺少 character-template 节点')

  const generationInput: CharacterImageGenerationInput = {
    type: 'character_image',
    projectId: run.projectId,
    prompt: activeNode.input.description,
    referenceMedia: activeNode.input.referenceMedia,
    spriteWidth: spriteSize.width,
    spriteHeight: spriteSize.height,
  }

  return {
    run: {
      ...run,
      generationStatus: 'in_progress' as const,
      nodes: run.nodes.map((node) => {
        if (node.id === activeNode.id) return { ...node, status: 'passed' as const }
        if (node.id !== templateNode.id || node.type !== 'character-template') return node
        return {
          ...node,
          status: 'active' as const,
          input: generationInput,
        }
      }),
    },
    target: { runId: run.id, nodeId: templateNode.id },
  }
}

export function confirmFirstFrameState(run: WorkflowRun): WorkflowRun {
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可推进：${run.status}`)
  const firstFrameNode = run.nodes.find((node) => node.type === 'action-first-frame')
  if (!firstFrameNode || firstFrameNode.status !== 'active') {
    throw new Error('当前只能确认处于 active 状态的首帧节点')
  }

  return {
    ...run,
    nodes: run.nodes.map((node) => {
      if (node.id === firstFrameNode.id && node.type === 'action-first-frame') {
        return { ...node, status: 'passed' as const }
      }
      if (node.type === 'action-full-frame') {
        return { ...node, status: 'active' as const }
      }
      return node
    }),
  }
}

export function completeActionGenerationState(
  run: WorkflowRun,
  result: CharacterActionOutput | { error: string },
): WorkflowRun {
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可完成动作生成：${run.status}`)
  const actionNode = getActiveNode(run)
  if (
    !actionNode ||
    (actionNode.type !== 'action-first-frame' && actionNode.type !== 'action-full-frame')
  ) {
    throw new Error('当前只能完成处于 active 状态的动作生成节点')
  }

  const failed = result !== null && typeof result === 'object' && 'error' in result
  const actionIndex = run.nodes.findIndex((node) => node.id === actionNode.id)

  const updated = replaceWorkflowNode(run, actionNode.id, (current) => {
    if (current.type !== 'action-first-frame' && current.type !== 'action-full-frame')
      return current
    return {
      ...current,
      status: failed ? ('failed' as const) : ('passed' as const),
      output: failed ? null : result,
      error: failed ? String((result as { error: string }).error) : null,
      taskId: null,
      submissionId: null,
    }
  })

  // 找到下一个节点并激活
  const nextNode = updated.nodes[actionIndex + 1]
  return {
    ...updated,
    nodes: updated.nodes.map((node) => {
      if (failed || !nextNode || node.id !== nextNode.id) return node
      return { ...node, status: 'active' as const }
    }),
    status: failed ? ('failed' as const) : updated.status,
    generationStatus: failed ? ('failed' as const) : ('completed' as const),
  }
}

export function approveReviewState(run: WorkflowRun): WorkflowRun {
  if (run.status !== 'active') throw new Error(`WorkflowRun 当前不可审核：${run.status}`)
  const reviewNode = getActiveNode(run)
  if (!reviewNode || reviewNode.type !== 'review') {
    throw new Error('当前只能通过处于 active 状态的审核节点')
  }

  return {
    ...run,
    status: 'completed',
    nodes: run.nodes.map((node) =>
      node.id === reviewNode.id ? { ...node, status: 'passed' as const, error: null } : node,
    ),
  }
}

export function appendActionState(run: WorkflowRun): WorkflowRun {
  if (run.status !== 'completed') throw new Error('只能给已完成的 WorkflowRun 追加动作')
  if (!run.characterId || !run.outfitId) throw new Error('WorkflowRun 尚未绑定角色与造型')

  const actionNumber = run.nodes.filter((node) => node.type === 'action-full-frame').length + 1
  const actionNode = {
    ...createInitialNode('action-full-frame', run.id, run.nodes.length, null),
    id: `${run.id}:action-full-frame:${actionNumber}`,
    status: 'active' as const,
  }
  const reviewNode = {
    ...createInitialNode('review', run.id, run.nodes.length + 1, null),
    id: `${run.id}:review:${actionNumber}`,
    status: 'locked' as const,
  }

  return {
    ...run,
    status: 'active',
    generationStatus: 'not_started',
    exportStatus: 'not_exported',
    nodes: [...run.nodes, actionNode, reviewNode],
  }
}

export function beginActionGenerationState(
  run: WorkflowRun,
  input: CharacterActionGenerationInput,
  submissionId: string,
): WorkflowRun {
  const activeRun = requireActiveWorkflow(run)
  const actionNode = getActiveNode(activeRun)
  if (
    !actionNode ||
    (actionNode.type !== 'action-first-frame' && actionNode.type !== 'action-full-frame') ||
    actionNode.taskId
  ) {
    throw new Error('当前动作生成节点不可重复提交')
  }
  return replaceWorkflowNode(activeRun, actionNode.id, (current) => {
    if (current.type !== 'action-first-frame' && current.type !== 'action-full-frame')
      return current
    return { ...current, input, submissionId, error: null }
  })
}

export function recordActionGenerationTaskState(
  run: WorkflowRun,
  taskId: string,
  input?: CharacterActionGenerationInput,
): WorkflowRun {
  if (run.status !== 'active' && run.status !== 'interrupted') {
    throw new Error(`WorkflowRun 当前不可记录任务：${run.status}`)
  }
  const actionNode = getActiveNode(run)
  if (
    !actionNode ||
    (actionNode.type !== 'action-first-frame' && actionNode.type !== 'action-full-frame')
  ) {
    throw new Error('当前只能为 active 状态的动作生成节点记录任务')
  }
  return replaceWorkflowNode(run, actionNode.id, (current) => {
    if (current.type !== 'action-first-frame' && current.type !== 'action-full-frame')
      return current
    return { ...current, taskId, input: input ?? current.input, submissionId: null }
  })
}

export function interruptWorkflowRunState(run: WorkflowRun): WorkflowRun {
  return run.status === 'active' ? { ...run, status: 'interrupted' } : run
}

export function restartWorkflowRunState(
  run: WorkflowRun,
  restartNodeId: WorkflowNode['id'],
): WorkflowRun {
  const restartIndex = run.nodes.findIndex((node) => node.id === restartNodeId)
  const restartNode = run.nodes[restartIndex]
  if (!restartNode || restartNode.status !== 'passed') {
    throw new Error('只能从已通过的节点重新开始')
  }

  const retainedNodeCount =
    restartIndex < 3
      ? WORKFLOW_NODE_ORDER.length
      : restartNode.type === 'action-full-frame'
        ? restartIndex + 2
        : restartIndex + 1

  const nodes = run.nodes.slice(0, retainedNodeCount).map((node, index) => {
    if (index < restartIndex) {
      return { ...structuredClone(node), status: 'passed' as const, taskId: null, submissionId: null, error: null }
    }
    if (index === restartIndex) {
      return { ...structuredClone(node), status: 'active' as const, taskId: null, submissionId: null, error: null, output: null } as WorkflowNode
    }
    return lockFreshNode(node.type, run.id, index, run.prompt)
  })

  return {
    ...run,
    status: 'active',
    nodes,
    generationStatus: 'not_started',
    exportStatus: 'not_exported',
  }
}

function lockFreshNode(
  type: WorkflowNodeType,
  runId: WorkflowRun['id'],
  index: number,
  prompt: string | null,
): WorkflowNode {
  return {
    ...createInitialNode(type, runId, index, prompt),
    status: 'locked',
  }
}

function createInitialNode(
  type: WorkflowNodeType,
  runId: string,
  index: number,
  prompt: string | null,
): WorkflowNode {
  const status: WorkflowNodeStatus = index === 0 ? 'active' : 'locked'
  const base = {
    id: createNodeId(runId, type, index),
    status,
    taskId: null,
    submissionId: null,
    error: null,
  }

  if (type === 'character-setup') {
    return {
      ...base,
      type,
      input: prompt ? { description: prompt, referenceMedia: [] } : null,
      output: null,
    }
  }
  if (type === 'character-template') {
    return { ...base, type, input: null, output: null }
  }
  if (type === 'action-first-frame' || type === 'action-full-frame') {
    return { ...base, type, input: null, output: null }
  }
  return { ...base, type, input: null, output: null } as WorkflowNode
}

function createNodeId(runId: string, type: WorkflowNodeType, index: number): string {
  if (index < WORKFLOW_NODE_ORDER.length) return `${runId}:${type}`
  const actionNumber = Math.floor((index - WORKFLOW_NODE_ORDER.length) / 2) + 1
  return `${runId}:${type}:${actionNumber}`
}
