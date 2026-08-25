import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText as aiGenerateText, jsonSchema, tool } from 'ai'

import {
  REFINE_CHARACTER_TEMPLATE_TOOL,
  REFINE_FIRST_FRAME_TOOL,
  REGENERATE_CHARACTER_TEMPLATE_TOOL,
  REGENERATE_FIRST_FRAME_TOOL,
  parseQuickStartDecision,
  QUICK_START_DECISION_TOOL,
  validatePlannerTerminal,
  type PlannerInput,
  type PlannerResult,
  type QuickStartDecision,
  type QuickStartPlanner,
  type WorkflowAgentContext,
  type WorkflowAgentToolName,
} from './runtime'

interface GenerateTextResultLike {
  text: string
  finishReason: string
  toolCalls: readonly { toolName: string; input: unknown }[]
}

interface GenerateTextOptionsLike {
  model: unknown
  instructions: string
  messages: PlannerInput['messages']
  tools: Record<string, { execute?: unknown }>
  toolChoice: 'auto' | 'required'
  maxRetries: 0
  abortSignal?: AbortSignal
  repairToolCall?: (options: {
    toolCall: { toolCallId: string; toolName: string; input: string; [key: string]: unknown }
    error: Error
  }) => Promise<{
    toolCallId: string
    toolName: string
    input: string
    [key: string]: unknown
  } | null>
}

export type QuickStartGenerateText = (
  options: GenerateTextOptionsLike,
) => Promise<GenerateTextResultLike>

export interface CreateAiSdkQuickStartPlannerOptions {
  baseURL: string
  modelId?: string
  fetch?: typeof globalThis.fetch
  /** 仅用于协议级测试；生产默认调用 AI SDK Core generateText。 */
  generateText?: QuickStartGenerateText
}

// AI SDK 会在 messages 前加入一条 instructions system message；后端总上限为 16 条。
const MAX_PLANNER_HISTORY_MESSAGES = 15

const quickStartDecisionTool = tool({
  description:
    '返回本轮唯一决策：正常回复、一次必要澄清、无法继续的说明，或供用户选择采用的角色母版提示词提案。',
  inputSchema: jsonSchema<QuickStartDecision>(
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          enum: ['reply', 'clarification', 'blocked', 'proposal'],
        },
        message: { type: 'string', minLength: 1, maxLength: 2_000 },
        optimizedPrompt: { type: 'string', minLength: 1, maxLength: 4_000 },
        actionPrompt: { type: 'string', minLength: 1, maxLength: 4_000 },
        optimizationSummary: { type: 'string', minLength: 1, maxLength: 600 },
      },
      oneOf: [
        {
          properties: { kind: { type: 'string', enum: ['proposal'] } },
          required: ['kind', 'optimizedPrompt', 'optimizationSummary'],
        },
        {
          properties: {
            kind: { type: 'string', enum: ['reply', 'clarification', 'blocked'] },
          },
          required: ['kind', 'message'],
        },
      ],
    },
    {
      validate(value) {
        try {
          return { success: true, value: parseQuickStartDecision(value) }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error('Planner 决策无效'),
          }
        }
      },
    },
  ),
})

const regenerateToolSchema = jsonSchema<Record<string, never>>({
  type: 'object',
  additionalProperties: false,
  properties: {},
})

const refinementToolSchema = jsonSchema<{ adjustmentPrompt: string }>({
  type: 'object',
  additionalProperties: false,
  properties: {
    adjustmentPrompt: {
      type: 'string',
      minLength: 1,
      maxLength: 4_000,
      description: '只描述相对上一版需要改变的内容，不重复角色或动作的完整原始描述。',
    },
  },
  required: ['adjustmentPrompt'],
})

const workflowTools = {
  [REGENERATE_CHARACTER_TEMPLATE_TOOL]: tool({
    description: '用户明确要求放弃当前角色母版结果并按原始描述重新生成时使用。',
    inputSchema: regenerateToolSchema,
  }),
  [REFINE_CHARACTER_TEMPLATE_TOOL]: tool({
    description: '用户要求基于已确认的角色母版修改外观、服装、颜色或角色细节时使用。',
    inputSchema: refinementToolSchema,
  }),
  [REGENERATE_FIRST_FRAME_TOOL]: tool({
    description: '用户明确要求放弃当前动作首帧并按原始动作描述重新生成时使用。',
    inputSchema: regenerateToolSchema,
  }),
  [REFINE_FIRST_FRAME_TOOL]: tool({
    description: '用户要求基于已确认的动作首帧修改姿态、朝向或动作起始细节时使用。',
    inputSchema: refinementToolSchema,
  }),
}

function recordInput(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function deterministicDecisionRepair(value: unknown): Record<string, unknown> | null {
  const input = recordInput(value)
  if (!input) return null
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  const candidate =
    input.kind === 'proposal' && !input.optimizationSummary && message
      ? { ...input, optimizationSummary: message }
      : input
  try {
    parseQuickStartDecision(candidate)
    return candidate
  } catch {
    return null
  }
}

function fallbackPlannerResult(
  result: PlannerResult,
  messages: PlannerInput['messages'],
): PlannerResult {
  try {
    validatePlannerTerminal(result)
    return result
  } catch {
    const call = result.toolCalls[0]
    const input = recordInput(call?.input)
    if (call?.toolName === QUICK_START_DECISION_TOOL && input?.kind === 'proposal') {
      const latestUserInput = messages
        .findLast((message) => message.role === 'user')
        ?.content.trim()
      const optimizedPrompt =
        typeof input.optimizedPrompt === 'string' && input.optimizedPrompt.trim()
          ? input.optimizedPrompt.trim().slice(0, 4_000)
          : latestUserInput?.slice(0, 4_000)
      if (optimizedPrompt) {
        const suppliedSummary =
          typeof input.optimizationSummary === 'string' && input.optimizationSummary.trim()
            ? input.optimizationSummary.trim()
            : typeof input.message === 'string' && input.message.trim()
              ? input.message.trim()
              : ''
        return {
          text: '',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolName: QUICK_START_DECISION_TOOL,
              input: {
                kind: 'proposal',
                optimizedPrompt,
                optimizationSummary:
                  suppliedSummary.slice(0, 600) ||
                  '我先完整保留了你的原始描述，你可以直接采用或继续补充细节。',
              },
            },
          ],
        }
      }
    }

    const message = typeof input?.message === 'string' ? input.message.trim() : ''
    return {
      text: message.slice(0, 2_000) || '请再补充一个最想保留的角色特征，我会继续整理。',
      finishReason: 'stop',
      toolCalls: [],
    }
  }
}

export function quickStartPlannerInstructions(clarificationUsed: boolean): string {
  const clarificationRule = clarificationUsed
    ? '本草稿已经问过一次必要澄清，不得因为轮数强制生成，也不得再问第二个澄清问题；信息不足时用 reply 说明可继续补充，存在硬冲突时用 blocked。'
    : '本草稿尚未问过必要澄清。只有缺少会实质改变角色母版的关键信息时，才可以用 clarification 问一个最关键的问题。'
  return `你是 Windup Quick Start 的轻量 Planner。你只理解当前草稿、回复用户，并在合适时给出角色母版提示词提案；你不执行生成，也不参与生成后的流程。

每轮必须调用一次 ${QUICK_START_DECISION_TOOL}，并只返回一个决策：
- reply：闲聊、回顾历史、评价、比较方案、解释或继续讨论。reply 不消耗澄清额度。
- clarification：确实缺少一个会实质改变角色母版的关键信息时，最多问一个问题。
- blocked：存在安全问题、明显自相矛盾或超出单角色母版能力，说明需要修改的内容。
- proposal：已有足够角色设定，或用户明确要求整理最终提示词、直接生成时，给出可选择采用的完整提案。proposal 只是提案，不代表用户授权生成。

当前能力面向一个角色及其可选动作。optimizedPrompt 只描述稳定的单角色母版：完整身体、清楚轮廓，保留身份、外观、服装、气质和美术风格。用户明确给出动作时，必须把动作单独写入 actionPrompt；没有动作时省略 actionPrompt，不得替用户补动作。

决策规则：
1. 对话轮数永远不是 proposal 的触发条件。不得在澄清额度用完后用默认值强制补齐并提案。
2. “你觉得怎么样”“怎么优化好”“还有什么方案”“刚才我说了什么”等咨询或元对话必须用 reply；不得只靠关键词，要理解最新消息在完整上下文中的意图。
3. 用户明确要求形成最终版本或直接生成时，可以返回 proposal，但宿主仍会要求用户确认一次；确认前不得生成。
4. proposal 的 optimizedPrompt 是完整单角色全身提示词；actionPrompt 只保存用户明确给出的动作；optimizationSummary 用一到两句正常对话确认你理解的角色和动作，并请用户确认一次。
5. 不得输出思维过程、逐步推理、默认假设清单、Tool 名称、调用计划或内部状态。

${clarificationRule}`
}

function quickStartWorkflowInstructions(context: WorkflowAgentContext): string {
  const targets = context.availableTools.some((name) => name.includes('character_template'))
    ? context.availableTools.some((name) => name.includes('first_frame'))
      ? '已确认的角色母版和动作首帧'
      : '已确认的角色母版'
    : '已确认的动作首帧'
  return `你是 Windup 生成流程中的轻量 Agent。当前可修改：${targets}。宿主只会在生成任务停止、结果允许修改时调用你。

用户明确要求重新生成时，选择与目标对应的 regenerate Tool；重新生成不携带修改描述。用户给出相对上一版的具体修改时，选择对应的 refine Tool，并把具体变化写入 adjustmentPrompt。用户意图含糊、没有说明修改对象或只是在讨论时，直接用简短中文回复澄清，不调用 Tool。否定、引用或假设语境不得触发 Tool。

每轮最多调用一个 Tool。不得输出思维过程、Tool 名称、内部状态或调用计划。所有实际修改由宿主绑定的 WorkflowController 完成。`
}

export function createAiSdkQuickStartPlanner({
  baseURL,
  modelId = 'quick-start-planner',
  fetch,
  generateText = aiGenerateText as unknown as QuickStartGenerateText,
}: CreateAiSdkQuickStartPlannerOptions): QuickStartPlanner {
  const provider = createOpenAICompatible({
    name: 'windup-agent-proxy',
    baseURL: baseURL.replace(/\/+$/u, ''),
    fetch,
  })
  const model = provider.chatModel(modelId)

  return async ({ messages, clarificationUsed, workflow, signal }): Promise<PlannerResult> => {
    const tools = workflow
      ? Object.fromEntries(
          workflow.availableTools.map((name: WorkflowAgentToolName) => [name, workflowTools[name]]),
        )
      : { [QUICK_START_DECISION_TOOL]: quickStartDecisionTool }
    const instructions = workflow
      ? quickStartWorkflowInstructions(workflow)
      : quickStartPlannerInstructions(clarificationUsed)
    const history = messages.slice(-MAX_PLANNER_HISTORY_MESSAGES)
    const result = await generateText({
      model,
      instructions,
      messages: history,
      tools,
      toolChoice: workflow ? 'auto' : 'required',
      maxRetries: 0,
      abortSignal: signal,
      repairToolCall: workflow
        ? undefined
        : async ({ toolCall, error }) => {
            if (toolCall.toolName !== QUICK_START_DECISION_TOOL) return null
            const repairedInput = deterministicDecisionRepair(toolCall.input)
            if (repairedInput) {
              return { ...toolCall, input: JSON.stringify(repairedInput) }
            }

            const repairResult = await generateText({
              model,
              instructions: `${instructions}\n\n上一份 Tool 参数没有通过合同校验。只修复参数结构，不改变用户意图。`,
              messages: [
                ...history.slice(-(MAX_PLANNER_HISTORY_MESSAGES - 1)),
                {
                  role: 'user',
                  content: `请重新返回合法的 ${QUICK_START_DECISION_TOOL} 参数。上一份参数：${String(toolCall.input).slice(0, 6_000)}。校验错误：${error.message}`,
                },
              ],
              tools,
              toolChoice: 'required',
              maxRetries: 0,
              abortSignal: signal,
            })
            const repairedCall = repairResult.toolCalls.find(
              (call) => call.toolName === QUICK_START_DECISION_TOOL,
            )
            return repairedCall ? { ...toolCall, input: JSON.stringify(repairedCall.input) } : null
          },
    })
    const plannerResult: PlannerResult = {
      text: result.text,
      finishReason: result.finishReason,
      toolCalls: result.toolCalls.map((call) => ({
        toolName: call.toolName,
        input: call.input,
      })),
    }
    return workflow ? plannerResult : fallbackPlannerResult(plannerResult, messages)
  }
}
