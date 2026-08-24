export const QUICK_START_DECISION_TOOL = 'quick_start_decision' as const
/** 旧前端测试与灰度响应的只读兼容名；命中时只生成提案，不会直接写入。 */
export const START_CHARACTER_GENERATION_TOOL = 'start_character_generation' as const
export const REGENERATE_CHARACTER_TEMPLATE_TOOL = 'regenerate_character_template' as const
export const REFINE_CHARACTER_TEMPLATE_TOOL = 'refine_character_template' as const
export const REGENERATE_FIRST_FRAME_TOOL = 'regenerate_first_frame' as const
export const REFINE_FIRST_FRAME_TOOL = 'refine_first_frame' as const

const MAX_PROMPT_LENGTH = 4_000
const MAX_MESSAGE_LENGTH = 2_000
const MAX_OPTIMIZATION_SUMMARY_LENGTH = 600

export interface PlannerMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface PlannerToolCall {
  toolName: string
  input: unknown
}

export interface PlannerResult {
  text: string
  finishReason: string
  toolCalls: readonly PlannerToolCall[]
}

export interface PlannerInput {
  messages: readonly PlannerMessage[]
  clarificationUsed: boolean
  workflow?: WorkflowAgentContext
  signal?: AbortSignal
}

export type QuickStartPlanner = (input: PlannerInput) => Promise<PlannerResult>

export interface CharacterGenerationPlan {
  optimizedPrompt: string
  optimizationSummary: string
}

export interface CharacterGenerationProposal extends CharacterGenerationPlan {
  proposalId: string
}

export type QuickStartDecision =
  | { kind: 'reply'; message: string }
  | { kind: 'clarification'; message: string }
  | { kind: 'blocked'; message: string }
  | ({ kind: 'proposal' } & CharacterGenerationPlan)

export type QuickStartAgentResult =
  | { kind: 'message'; messageKind: 'reply' | 'clarification' | 'blocked'; message: string }
  | ({ kind: 'proposal' } & CharacterGenerationProposal)
  | ({ kind: 'generated'; runId: string } & CharacterGenerationProposal)

export interface QuickStartAgentTurnOptions {
  signal?: AbortSignal
}

export interface QuickStartAgent {
  start(input: string, options?: QuickStartAgentTurnOptions): Promise<QuickStartAgentResult>
  continue(input: string, options?: QuickStartAgentTurnOptions): Promise<QuickStartAgentResult>
  confirmProposal(proposalId: string, prompt: string): Promise<QuickStartAgentResult>
  revoke(): void
}

/** 宿主从现有 WorkflowController 绑定出的单次生成动作；本 Feature 不拥有业务对象。 */
export type StartCharacterGenerationAction = (input: {
  prompt: string
}) => Promise<{ runId: string }>

export interface CreateQuickStartAgentOptions {
  planner: QuickStartPlanner
  startCharacterGeneration: StartCharacterGenerationAction
  initialMessages?: readonly PlannerMessage[]
  initialClarificationUsed?: boolean
  initialProposal?: CharacterGenerationProposal | null
}

export type WorkflowAgentToolName =
  | typeof REGENERATE_CHARACTER_TEMPLATE_TOOL
  | typeof REFINE_CHARACTER_TEMPLATE_TOOL
  | typeof REGENERATE_FIRST_FRAME_TOOL
  | typeof REFINE_FIRST_FRAME_TOOL

export interface WorkflowAgentContext {
  availableTools: readonly WorkflowAgentToolName[]
}

export interface WorkflowAgentActions {
  getContext(): WorkflowAgentContext
  regenerateCharacterTemplate(): Promise<void>
  refineCharacterTemplate(adjustmentPrompt: string): Promise<void>
  regenerateFirstFrame(): Promise<void>
  refineFirstFrame(adjustmentPrompt: string): Promise<void>
}

export interface CreateQuickStartWorkflowAgentOptions {
  planner: QuickStartPlanner
  actions: WorkflowAgentActions
  initialMessages?: readonly PlannerMessage[]
}

export type QuickStartWorkflowAgentResult =
  | { kind: 'message'; message: string }
  | { kind: 'action'; action: WorkflowAgentToolName; message: string }

export interface QuickStartWorkflowAgent {
  submit(
    input: string,
    options?: QuickStartAgentTurnOptions,
  ): Promise<QuickStartWorkflowAgentResult>
  revoke(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMessage(value: unknown): string {
  const message = typeof value === 'string' ? value.trim() : ''
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    throw new Error('Planner 的文字决策无效')
  }
  return message
}

export function parseCharacterGenerationPlan(value: unknown): CharacterGenerationPlan {
  if (!isRecord(value)) throw new Error('生成提案参数必须是对象')
  const keys = Object.keys(value)
  if (
    keys.some(
      (key) => key !== 'kind' && key !== 'optimizedPrompt' && key !== 'optimizationSummary',
    ) ||
    (keys.includes('kind') && value.kind !== 'proposal') ||
    !keys.includes('optimizedPrompt') ||
    !keys.includes('optimizationSummary')
  ) {
    throw new Error('生成提案参数字段无效')
  }

  const optimizedPrompt =
    typeof value.optimizedPrompt === 'string' ? value.optimizedPrompt.trim() : ''
  if (!optimizedPrompt || optimizedPrompt.length > MAX_PROMPT_LENGTH) {
    throw new Error('生成提案的 optimizedPrompt 无效')
  }
  const optimizationSummary =
    typeof value.optimizationSummary === 'string' ? value.optimizationSummary.trim() : ''
  if (!optimizationSummary || optimizationSummary.length > MAX_OPTIMIZATION_SUMMARY_LENGTH) {
    throw new Error('生成提案的 optimizationSummary 无效')
  }
  return { optimizedPrompt, optimizationSummary }
}

export function parseQuickStartDecision(value: unknown): QuickStartDecision {
  if (!isRecord(value)) throw new Error('Planner 决策必须是对象')
  if (value.kind === 'proposal') {
    return { kind: 'proposal', ...parseCharacterGenerationPlan(value) }
  }
  if (value.kind !== 'reply' && value.kind !== 'clarification' && value.kind !== 'blocked') {
    throw new Error('Planner 决策类型无效')
  }
  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'kind' && key !== 'message') || !keys.includes('message')) {
    throw new Error('Planner 文字决策字段无效')
  }
  return { kind: value.kind, message: parseMessage(value.message) }
}

/** SDK 完整返回后再做一次 fail-closed 终态校验，校验通过前不触发业务 action。 */
export function validatePlannerTerminal(result: PlannerResult): QuickStartDecision {
  if (result.finishReason === 'stop' && result.toolCalls.length === 0) {
    return { kind: 'reply', message: parseMessage(result.text) }
  }
  if (result.finishReason !== 'tool-calls') {
    throw new Error('Planner 的决策响应未完整结束')
  }
  if (result.toolCalls.length !== 1) {
    throw new Error('Planner 每轮必须且只能返回一个决策')
  }
  const [call] = result.toolCalls
  if (call?.toolName === START_CHARACTER_GENERATION_TOOL) {
    return { kind: 'proposal', ...parseCharacterGenerationPlan(call.input) }
  }
  if (call?.toolName !== QUICK_START_DECISION_TOOL) {
    throw new Error('Planner 返回了未知决策')
  }
  return parseQuickStartDecision(call.input)
}

function abortError(): DOMException {
  return new DOMException('操作已取消', 'AbortError')
}

function proposalMessage(plan: CharacterGenerationPlan): string {
  return `${plan.optimizationSummary}\n\n提示词提案：${plan.optimizedPrompt}`
}

export function createQuickStartAgent({
  planner,
  startCharacterGeneration,
  initialMessages = [],
  initialClarificationUsed = false,
  initialProposal = null,
}: CreateQuickStartAgentOptions): QuickStartAgent {
  let started = initialMessages.length > 0
  let revoked = false
  let consumed = false
  let clarificationUsed = initialClarificationUsed
  let running = false
  let messages: PlannerMessage[] = [...initialMessages]
  let currentProposal = initialProposal

  function assertAuthorized() {
    if (revoked) throw new Error('生成授权已失效')
    if (consumed) throw new Error('生成授权已使用')
  }

  async function runTurn(
    input: string,
    { signal }: QuickStartAgentTurnOptions = {},
  ): Promise<QuickStartAgentResult> {
    assertAuthorized()
    if (running) throw new Error('Planner 正在处理上一条输入')
    const normalizedInput = input.trim()
    if (!normalizedInput) throw new Error('请先描述想要创建的角色')
    if (signal?.aborted) {
      revoked = true
      throw abortError()
    }

    running = true
    currentProposal = null
    try {
      const nextMessages: PlannerMessage[] = [
        ...messages,
        { role: 'user', content: normalizedInput },
      ]
      // 用户点击发送后，页面已经展示并持久化这条消息；即使 Planner 失败，
      // runtime 也必须保留同一历史，避免刷新前后得到不同上下文。
      messages = nextMessages
      const decision = validatePlannerTerminal(
        await planner({ messages: nextMessages, clarificationUsed, signal }),
      )
      if (signal?.aborted) {
        revoked = true
        throw abortError()
      }

      if (decision.kind !== 'proposal') {
        messages = [...nextMessages, { role: 'assistant', content: decision.message }]
        if (decision.kind === 'clarification') clarificationUsed = true
        return { kind: 'message', messageKind: decision.kind, message: decision.message }
      }

      const proposal: CharacterGenerationProposal = {
        proposalId: `proposal-${nextMessages.length}`,
        optimizedPrompt: decision.optimizedPrompt,
        optimizationSummary: decision.optimizationSummary,
      }
      currentProposal = proposal
      messages = [...nextMessages, { role: 'assistant', content: proposalMessage(proposal) }]
      return { kind: 'proposal', ...proposal }
    } finally {
      running = false
    }
  }

  async function confirmProposal(
    proposalId: string,
    prompt: string,
  ): Promise<QuickStartAgentResult> {
    assertAuthorized()
    if (running) throw new Error('Planner 正在处理上一条输入')
    if (!currentProposal || currentProposal.proposalId !== proposalId) {
      throw new Error('提示词提案已失效')
    }
    const effectivePrompt = prompt.trim()
    if (!effectivePrompt || effectivePrompt.length > MAX_PROMPT_LENGTH) {
      throw new Error('确认后的角色提示词无效')
    }

    running = true
    consumed = true
    const proposal = currentProposal
    currentProposal = null
    try {
      const { runId } = await startCharacterGeneration({ prompt: effectivePrompt })
      return { kind: 'generated', runId, ...proposal, optimizedPrompt: effectivePrompt }
    } finally {
      running = false
    }
  }

  return {
    start(input, options) {
      if (started) return Promise.reject(new Error('Agent 已开始，请继续当前输入'))
      started = true
      return runTurn(input, options)
    },
    continue(input, options) {
      if (!started) return Promise.reject(new Error('Agent 尚未开始'))
      return runTurn(input, options)
    },
    confirmProposal,
    revoke() {
      currentProposal = null
      if (!consumed) revoked = true
    },
  }
}

interface WorkflowActionTerminal {
  kind: 'action'
  action: WorkflowAgentToolName
  adjustmentPrompt?: string
}

function parseWorkflowActionInput(
  action: WorkflowAgentToolName,
  value: unknown,
): WorkflowActionTerminal {
  if (!isRecord(value)) throw new Error('工作流 Tool 参数必须是对象')
  if (action === REFINE_CHARACTER_TEMPLATE_TOOL || action === REFINE_FIRST_FRAME_TOOL) {
    if (
      Object.keys(value).some((key) => key !== 'adjustmentPrompt') ||
      !Object.hasOwn(value, 'adjustmentPrompt')
    ) {
      throw new Error('微调 Tool 参数字段无效')
    }
    const adjustmentPrompt =
      typeof value.adjustmentPrompt === 'string' ? value.adjustmentPrompt.trim() : ''
    if (!adjustmentPrompt || adjustmentPrompt.length > MAX_PROMPT_LENGTH) {
      throw new Error('微调描述无效')
    }
    return { kind: 'action', action, adjustmentPrompt }
  }
  if (Object.keys(value).length > 0) throw new Error('重新生成 Tool 不接受参数')
  return { kind: 'action', action }
}

function validateWorkflowPlannerTerminal(
  result: PlannerResult,
  context: WorkflowAgentContext,
): { kind: 'message'; message: string } | WorkflowActionTerminal {
  if (result.toolCalls.length === 0) {
    if (result.finishReason !== 'stop') throw new Error('Planner 的工作流回复未完整结束')
    return { kind: 'message', message: parseMessage(result.text) }
  }
  if (result.finishReason !== 'tool-calls' || result.toolCalls.length !== 1) {
    throw new Error('Planner 每轮必须且只能调用一个工作流 Tool')
  }
  const [call] = result.toolCalls
  const action = call?.toolName as WorkflowAgentToolName | undefined
  if (!action || !context.availableTools.includes(action)) {
    throw new Error('当前流程不能执行该操作')
  }
  return parseWorkflowActionInput(action, call.input)
}

function workflowActionMessage(action: WorkflowAgentToolName): string {
  switch (action) {
    case REGENERATE_CHARACTER_TEMPLATE_TOOL:
      return '已提交角色母版重新生成。'
    case REFINE_CHARACTER_TEMPLATE_TOOL:
      return '已提交角色母版微调。'
    case REGENERATE_FIRST_FRAME_TOOL:
      return '已提交动作首帧重新生成。'
    case REFINE_FIRST_FRAME_TOOL:
      return '已提交动作首帧微调。'
  }
}

export function createQuickStartWorkflowAgent({
  planner,
  actions,
  initialMessages = [],
}: CreateQuickStartWorkflowAgentOptions): QuickStartWorkflowAgent {
  let messages = [...initialMessages]
  let running = false
  let revoked = false

  async function submit(
    input: string,
    { signal }: QuickStartAgentTurnOptions = {},
  ): Promise<QuickStartWorkflowAgentResult> {
    if (revoked) throw new Error('工作流 Agent 已失效')
    if (running) throw new Error('Planner 正在处理上一条输入')
    const normalizedInput = input.trim()
    if (!normalizedInput) throw new Error('请输入想要调整的内容')
    if (signal?.aborted) {
      revoked = true
      throw abortError()
    }

    running = true
    try {
      const context = actions.getContext()
      const nextMessages = [...messages, { role: 'user' as const, content: normalizedInput }]
      messages = nextMessages
      const terminal = validateWorkflowPlannerTerminal(
        await planner({
          messages: nextMessages,
          clarificationUsed: false,
          workflow: context,
          signal,
        }),
        context,
      )
      if (signal?.aborted) {
        revoked = true
        throw abortError()
      }
      if (terminal.kind === 'message') {
        messages = [...nextMessages, { role: 'assistant', content: terminal.message }]
        return terminal
      }

      switch (terminal.action) {
        case REGENERATE_CHARACTER_TEMPLATE_TOOL:
          await actions.regenerateCharacterTemplate()
          break
        case REFINE_CHARACTER_TEMPLATE_TOOL:
          await actions.refineCharacterTemplate(terminal.adjustmentPrompt!)
          break
        case REGENERATE_FIRST_FRAME_TOOL:
          await actions.regenerateFirstFrame()
          break
        case REFINE_FIRST_FRAME_TOOL:
          await actions.refineFirstFrame(terminal.adjustmentPrompt!)
          break
      }
      const message = workflowActionMessage(terminal.action)
      messages = [...nextMessages, { role: 'assistant', content: message }]
      return { kind: 'action', action: terminal.action, message }
    } finally {
      running = false
    }
  }

  return {
    submit,
    revoke() {
      revoked = true
    },
  }
}
