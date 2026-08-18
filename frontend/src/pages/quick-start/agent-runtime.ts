import type { WorkflowNode, WorkflowRun } from '@/entities'

const GET_WORKFLOW_CONTEXT = 'get_workflow_context' as const

export const QUICK_START_AGENT_INSTRUCTIONS = [
  '你是 Windup Quick Start 的对话助手，只围绕当前 WorkflowRun 回答。',
  '需要了解当前进度时调用 get_workflow_context；每轮最多调用一次 function。',
  '你没有修改工作流的能力，不要声称已经创建、重生成、微调、回退或保存任何资产。',
].join('\n')

export interface AgentFunctionDefinition {
  name: typeof GET_WORKFLOW_CONTEXT
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, never>
    additionalProperties: false
  }
}

export const QUICK_START_AGENT_TOOLS: readonly AgentFunctionDefinition[] = [
  {
    name: GET_WORKFLOW_CONTEXT,
    description: '读取当前 Quick Start WorkflowRun 的阶段与节点状态，不修改任何业务数据。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
]

export interface AgentFunctionCall {
  callId: string
  name: string
  arguments: Record<string, unknown>
}

export type AgentTransportMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; functionCall?: AgentFunctionCall }
  | { role: 'tool'; callId: string; name: string; content: string }

export interface AgentTransportRequest {
  instructions: string
  messages: readonly AgentTransportMessage[]
  tools: readonly AgentFunctionDefinition[]
  signal?: AbortSignal
}

export type AgentTransportEvent =
  | { type: 'text'; text: string }
  | ({ type: 'function-call' } & AgentFunctionCall)
  | { type: 'completed' }
  | { type: 'failed'; error: string }

/** 模型 SDK、HTTP 与流协议留给适配器；Quick Start 只依赖这一条可注入边界。 */
export interface AgentTransport {
  stream(request: AgentTransportRequest): AsyncIterable<AgentTransportEvent>
}

export type QuickStartAgentRuntimeEvent =
  | { type: 'text'; text: string }
  | ({ type: 'function-call' } & AgentFunctionCall)
  | { type: 'tool-result'; callId: string; name: typeof GET_WORKFLOW_CONTEXT; content: string }
  | { type: 'completed' }
  | { type: 'failed'; error: string }

type QuickStartAllowedAction =
  | 'select-character-template'
  | 'select-action-first-frame'
  | 'approve-review'
  | 'retry-generation'

export interface QuickStartWorkflowContext {
  currentStage: WorkflowNode['type'] | null
  currentStatus: WorkflowNode['status'] | null
  currentPhase: WorkflowNode['phase'] | null
  isGenerating: boolean
  awaitingUserSelection: boolean
  failed: boolean
  allowedActions: QuickStartAllowedAction[]
  error: string | null
}

/**
 * Agent 只看懂回答当前进度所需的投影，不接触任务引用、媒体地址或完整节点输入。
 * 所有业务写入仍只能发生在 QuickStartSession 背后的 WorkflowController。
 */
export function getQuickStartWorkflowContext(run: WorkflowRun): QuickStartWorkflowContext {
  const nodes = run.nodes.filter((node) => !node.deletedAt)
  const current =
    nodes.findLast((node) => node.status === 'active' || node.status === 'failed') ??
    nodes.at(-1) ??
    null
  const allowedActions: QuickStartAllowedAction[] =
    current?.status === 'failed'
      ? ['retry-generation']
      : current?.type === 'character-template' && current.phase === 'selecting'
        ? ['select-character-template']
        : current?.type === 'action-first-frame' && current.phase === 'selecting'
          ? ['select-action-first-frame']
          : current?.type === 'review' && current.status === 'active'
            ? ['approve-review']
            : []

  return {
    currentStage: current?.type ?? null,
    currentStatus: current?.status ?? null,
    currentPhase: current?.phase ?? null,
    isGenerating: current?.phase === 'generating',
    awaitingUserSelection: current?.phase === 'selecting',
    failed: current?.status === 'failed',
    allowedActions,
    error: current?.error ?? null,
  }
}

export interface RunQuickStartAgentTurnOptions {
  transport: AgentTransport
  history: readonly AgentTransportMessage[]
  input: string
  getWorkflow: () => WorkflowRun
  signal?: AbortSignal
  onEvent?: (event: QuickStartAgentRuntimeEvent) => void
}

export interface QuickStartAgentTurnResult {
  history: AgentTransportMessage[]
  assistantText: string
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 执行一轮最小 Agent 循环；一轮最多读一次上下文，避免模型自行扩张调用链。 */
export async function runQuickStartAgentTurn({
  transport,
  history,
  input,
  getWorkflow,
  signal,
  onEvent,
}: RunQuickStartAgentTurnOptions): Promise<QuickStartAgentTurnResult> {
  const normalizedInput = input.trim()
  if (!normalizedInput) throw new Error('Agent 消息不能为空')

  const messages: AgentTransportMessage[] = [...history, { role: 'user', content: normalizedInput }]
  let assistantText = ''
  let functionCallCount = 0
  let failureEmitted = false

  try {
    while (true) {
      let responseText = ''
      let pendingFunctionCall: AgentFunctionCall | null = null
      let completed = false

      for await (const event of transport.stream({
        instructions: QUICK_START_AGENT_INSTRUCTIONS,
        messages: [...messages],
        tools: QUICK_START_AGENT_TOOLS,
        signal,
      })) {
        if (event.type === 'text') {
          responseText += event.text
          assistantText += event.text
          onEvent?.(event)
          continue
        }
        if (event.type === 'function-call') {
          functionCallCount += 1
          if (functionCallCount > 1) throw new Error('每轮最多调用一次 function')
          if (event.name !== GET_WORKFLOW_CONTEXT) {
            throw new Error(`不支持 function：${event.name}`)
          }
          if (Object.keys(event.arguments).length > 0) {
            throw new Error(`${GET_WORKFLOW_CONTEXT} 不接受参数`)
          }
          pendingFunctionCall = {
            callId: event.callId,
            name: event.name,
            arguments: event.arguments,
          }
          onEvent?.(event)
          continue
        }
        if (event.type === 'failed') {
          failureEmitted = true
          onEvent?.(event)
          throw new Error(event.error)
        }
        completed = true
        break
      }

      if (!completed) throw new Error('Agent Transport 未发送完成事件')

      if (pendingFunctionCall) {
        messages.push({
          role: 'assistant',
          content: responseText,
          functionCall: pendingFunctionCall,
        })
        const content = JSON.stringify(getQuickStartWorkflowContext(getWorkflow()))
        messages.push({
          role: 'tool',
          callId: pendingFunctionCall.callId,
          name: GET_WORKFLOW_CONTEXT,
          content,
        })
        onEvent?.({
          type: 'tool-result',
          callId: pendingFunctionCall.callId,
          name: GET_WORKFLOW_CONTEXT,
          content,
        })
        continue
      }

      messages.push({ role: 'assistant', content: responseText })
      onEvent?.({ type: 'completed' })
      return { history: messages, assistantText }
    }
  } catch (cause) {
    if (!failureEmitted) onEvent?.({ type: 'failed', error: errorMessage(cause) })
    throw cause
  }
}
