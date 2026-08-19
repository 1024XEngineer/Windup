export const START_CHARACTER_GENERATION_TOOL = 'start_character_generation' as const

const MAX_PROMPT_LENGTH = 4_000
const MAX_ASSUMPTIONS = 6
const MAX_ASSUMPTION_LENGTH = 200

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
  signal?: AbortSignal
}

export type QuickStartPlanner = (input: PlannerInput) => Promise<PlannerResult>

export interface CharacterGenerationPlan {
  optimizedPrompt: string
  assumptions: readonly string[]
}

export type ValidatedPlannerTerminal =
  | { kind: 'message'; message: string }
  | ({ kind: 'tool' } & CharacterGenerationPlan)

export type QuickStartAgentResult =
  | { kind: 'message'; message: string }
  | ({ kind: 'generated'; runId: string } & CharacterGenerationPlan)

export interface QuickStartAgentTurnOptions {
  signal?: AbortSignal
  /** 页面在此处先渲染实际 Prompt 与默认假设；回调完成前不得发起付费写操作。 */
  onBeforeDispatch?: (plan: CharacterGenerationPlan) => void | Promise<void>
}

export interface QuickStartAgent {
  start(input: string, options?: QuickStartAgentTurnOptions): Promise<QuickStartAgentResult>
  continue(input: string, options?: QuickStartAgentTurnOptions): Promise<QuickStartAgentResult>
  revoke(): void
}

/** 宿主从现有 WorkflowController 绑定出的单次生成动作；本 Feature 不拥有业务对象。 */
export type StartCharacterGenerationAction = (input: {
  prompt: string
}) => Promise<{ runId: string }>

export interface CreateQuickStartAgentOptions {
  planner: QuickStartPlanner
  startCharacterGeneration: StartCharacterGenerationAction
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCharacterGenerationPlan(value: unknown): CharacterGenerationPlan {
  if (!isRecord(value)) throw new Error('生成 Tool 参数必须是对象')
  const keys = Object.keys(value)
  if (
    keys.some((key) => key !== 'optimizedPrompt' && key !== 'assumptions') ||
    !keys.includes('optimizedPrompt') ||
    !keys.includes('assumptions')
  ) {
    throw new Error('生成 Tool 参数字段无效')
  }

  const optimizedPrompt =
    typeof value.optimizedPrompt === 'string' ? value.optimizedPrompt.trim() : ''
  if (!optimizedPrompt || optimizedPrompt.length > MAX_PROMPT_LENGTH) {
    throw new Error('生成 Tool 的 optimizedPrompt 无效')
  }
  if (!Array.isArray(value.assumptions) || value.assumptions.length > MAX_ASSUMPTIONS) {
    throw new Error('生成 Tool 的 assumptions 无效')
  }
  const assumptions = value.assumptions.map((assumption) => {
    const normalized = typeof assumption === 'string' ? assumption.trim() : ''
    if (!normalized || normalized.length > MAX_ASSUMPTION_LENGTH) {
      throw new Error('生成 Tool 的 assumptions 无效')
    }
    return normalized
  })
  return { optimizedPrompt, assumptions }
}

/** SDK 完整返回后再做一次 fail-closed 终态校验，校验通过前不触发业务 action。 */
export function validatePlannerTerminal(result: PlannerResult): ValidatedPlannerTerminal {
  if (result.toolCalls.length === 0) {
    const message = result.text.trim()
    if (result.finishReason !== 'stop' || !message) {
      throw new Error('Planner 未返回完整的文字响应')
    }
    return { kind: 'message', message }
  }

  if (result.finishReason !== 'tool-calls') {
    throw new Error('Planner 的 Tool Call 响应未完整结束')
  }
  if (result.toolCalls.length !== 1) {
    throw new Error('Planner 每轮必须且只能调用一个 Tool')
  }
  const [call] = result.toolCalls
  if (call?.toolName !== START_CHARACTER_GENERATION_TOOL) {
    throw new Error('Planner 调用了未知 Tool')
  }
  return { kind: 'tool', ...parseCharacterGenerationPlan(call.input) }
}

function abortError(): DOMException {
  return new DOMException('操作已取消', 'AbortError')
}

export function createQuickStartAgent({
  planner,
  startCharacterGeneration,
}: CreateQuickStartAgentOptions): QuickStartAgent {
  let started = false
  let revoked = false
  let consumed = false
  let clarificationUsed = false
  let running = false
  let messages: PlannerMessage[] = []

  function assertAuthorized() {
    if (revoked) throw new Error('生成授权已失效')
    if (consumed) throw new Error('生成授权已使用')
  }

  async function runTurn(
    input: string,
    { signal, onBeforeDispatch }: QuickStartAgentTurnOptions = {},
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
    try {
      const nextMessages: PlannerMessage[] = [
        ...messages,
        { role: 'user', content: normalizedInput },
      ]
      const terminal = validatePlannerTerminal(
        await planner({ messages: nextMessages, clarificationUsed, signal }),
      )
      if (signal?.aborted) {
        revoked = true
        throw abortError()
      }

      if (terminal.kind === 'message') {
        messages = [...nextMessages, { role: 'assistant', content: terminal.message }]
        clarificationUsed = true
        return terminal
      }

      const plan: CharacterGenerationPlan = {
        optimizedPrompt: terminal.optimizedPrompt,
        assumptions: terminal.assumptions,
      }
      await onBeforeDispatch?.(plan)
      if (signal?.aborted) {
        revoked = true
        throw abortError()
      }
      assertAuthorized()

      // 写权限在调用前消费。即使响应丢失，也不得自动重放可能已经计费的 action。
      consumed = true
      const { runId } = await startCharacterGeneration({
        prompt: plan.optimizedPrompt,
      })
      return { kind: 'generated', runId, ...plan }
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
    revoke() {
      if (!consumed) revoked = true
    },
  }
}
