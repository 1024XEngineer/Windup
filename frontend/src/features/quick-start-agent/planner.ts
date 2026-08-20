import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText as aiGenerateText, jsonSchema, tool } from 'ai'

import {
  parseCharacterGenerationPlan,
  START_CHARACTER_GENERATION_TOOL,
  type PlannerInput,
  type PlannerResult,
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
  toolChoice: 'auto'
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

interface StartCharacterGenerationToolInput {
  optimizedPrompt: string
  assumptions: string[]
}

const startCharacterGenerationTool = tool({
  description:
    '当角色母版信息已经足够，或用户明确要求跳过追问并直接生成时，提交唯一一次角色母版生成。',
  inputSchema: jsonSchema<StartCharacterGenerationToolInput>(
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        optimizedPrompt: {
          type: 'string',
          minLength: 1,
          maxLength: 4_000,
          description: '实际提交给角色母版生成器的完整单角色全身提示词。',
        },
        assumptions: {
          type: 'array',
          maxItems: 6,
          items: { type: 'string', minLength: 1, maxLength: 200 },
          description: '为了立即生成而采用、且需要向用户明确展示的默认假设。',
        },
      },
      required: ['optimizedPrompt', 'assumptions'],
    },
    {
      validate(value) {
        try {
          const plan = parseCharacterGenerationPlan(value)
          return {
            success: true,
            value: { optimizedPrompt: plan.optimizedPrompt, assumptions: [...plan.assumptions] },
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error('生成 Tool 参数无效'),
          }
        }
      },
    },
  ),
})

export function quickStartPlannerInstructions(clarificationUsed: boolean): string {
  const clarificationRule = clarificationUsed
    ? '追问额度已经用完。除非仍存在硬冲突，否则不得再提问题；请采用明确的默认假设并调用 Tool。'
    : '追问额度尚未使用。只有缺少会实质改变角色母版的关键信息时，才最多追问一个问题。'
  return `你是 Windup Quick Start 的轻量 Planner。用户已经通过“生成角色”主操作授予本页面会话一次角色母版生成权限。你只判断信息是否足够，并且最多调用一次 ${START_CHARACTER_GENERATION_TOOL}；你不参与生成后的任何流程。

当前能力只生成一个角色的角色母版：单角色、完整身体、清楚轮廓，适合后续动作生成。保留用户明确给出的身份、外观、服装、气质和美术风格，把口语整理成可直接生成的 optimizedPrompt。用户描述的动态动作不要写进角色母版 Prompt；需要时在 assumptions 中明确“动作将在角色母版确认后处理”。

决策规则：
1. 信息足够时立即调用唯一 Tool，不要再次确认。
2. 用户在语义上明确要求“跳过、不用问、直接生成”时，基于已有信息与可见默认假设立即调用 Tool。
3. 用户明确表示“不要生成、只润色、先讨论”等否定意图时不得调用 Tool。引用、假设或否定语境也不得被误判；不得依赖关键词匹配，必须理解整句语义。
4. 信息不足且仍有追问额度时，只问一个最关键、最容易回答的问题，不得列问卷。
5. 输入有明显自相矛盾、违反内容政策，或超出当前单角色母版能力的硬冲突时，简短说明需要修改的具体内容，不调用 Tool。Planner 的提醒只是交互提示，最终安全、配额与计费仍由生成后端负责。
6. 调用 Tool 时，optimizedPrompt 必须是最终实际使用的提示词；assumptions 只列确实采用的默认值，可以为空。不得产生第二个 Tool Call。

${clarificationRule}

不调用 Tool 时，只输出一条简短的中文追问或修改提醒。调用 Tool 后不再输出后续计划。`
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
      tools: { [START_CHARACTER_GENERATION_TOOL]: startCharacterGenerationTool },
      toolChoice: 'auto',
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
