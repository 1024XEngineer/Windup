import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText as aiGenerateText, jsonSchema, tool } from 'ai'

import {
  parseQuickStartDecision,
  QUICK_START_DECISION_TOOL,
  type PlannerInput,
  type PlannerResult,
  type QuickStartDecision,
  type QuickStartPlanner,
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
  toolChoice: 'required'
  maxRetries: 0
  abortSignal?: AbortSignal
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
        optimizationSummary: { type: 'string', minLength: 1, maxLength: 600 },
      },
      required: ['kind'],
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

当前能力只面向一个角色的角色母版：单角色、完整身体、清楚轮廓，适合后续动作生成。保留用户明确给出的身份、外观、服装、气质和美术风格；动态动作留到角色母版确认后处理。

决策规则：
1. 对话轮数永远不是 proposal 的触发条件。不得在澄清额度用完后用默认值强制补齐并提案。
2. “你觉得怎么样”“怎么优化好”“还有什么方案”“刚才我说了什么”等咨询或元对话必须用 reply；不得只靠关键词，要理解最新消息在完整上下文中的意图。
3. 用户明确要求形成最终版本或直接生成时，可以返回 proposal，但宿主仍会要求用户主动填入、编辑并确认后才生成。
4. proposal 的 optimizedPrompt 是完整单角色全身提示词；optimizationSummary 用一到两句正常对话说明保留、补充或移除了什么。
5. 不得输出思维过程、逐步推理、默认假设清单、Tool 名称、调用计划或内部状态。

${clarificationRule}`
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

  return async ({ messages, clarificationUsed, signal }): Promise<PlannerResult> => {
    const result = await generateText({
      model,
      instructions: quickStartPlannerInstructions(clarificationUsed),
      messages,
      tools: { [QUICK_START_DECISION_TOOL]: quickStartDecisionTool },
      toolChoice: 'required',
      maxRetries: 0,
      abortSignal: signal,
    })
    return {
      text: result.text,
      finishReason: result.finishReason,
      toolCalls: result.toolCalls.map((call) => ({
        toolName: call.toolName,
        input: call.input,
      })),
    }
  }
}
