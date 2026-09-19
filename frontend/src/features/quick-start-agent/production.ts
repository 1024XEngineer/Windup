import {
  isArtStyle,
  createAuthenticatedGenerationApis,
  projectApis,
  workflowRunApis,
  type GenerationApis,
  type MediaReference,
  type WorkflowRunApis,
} from '@/entities'
import {
  type CreateQuickStartAgentOptions,
  type QuickStartPlanner,
} from '@/features/quick-start-agent/runtime'
import {
  createAutoPrepareProject,
  createWorkflowController,
  type CreateWorkflowControllerOptions,
  type PrepareQuickStartProject,
  type WorkflowController,
} from '@/features/workflow-controller'
import { getApiAccessToken, recoverApiUnauthorized, resolveApiBaseUrl } from '@/shared/api'

const REQUEST_ID_HEADER = 'x-request-id'
const CONTENT_POLICY_GUIDANCE =
  '内容已被安全检查拦截。请去掉违规或试图绕过规则的内容，只保留角色外观或一个明确动作后重试。'

interface CreateAgentProxyFetchOptions {
  fetchFn?: typeof globalThis.fetch
  getAccessToken?: () => string | null | undefined
  recoverUnauthorized?: () => Promise<boolean>
}

function rewriteAgentProxyUrl(value: string): string {
  const url = new URL(value)
  const sdkPath = '/chat/completions'
  if (!url.pathname.endsWith(sdkPath)) {
    throw new Error('AI SDK 请求未命中 Chat Completions 路径')
  }
  url.pathname = `${url.pathname.slice(0, -sdkPath.length)}/chat`
  return url.toString()
}

export function resolveAgentProxyBaseUrl(
  apiBaseUrl: string,
  origin = globalThis.location?.origin,
): string {
  if (!origin) throw new Error('当前环境无法解析 Agent API 地址')
  const normalizedApiBase = apiBaseUrl.replace(/\/+$/u, '')
  return new URL(`${normalizedApiBase}/ai`, `${origin}/`).toString().replace(/\/+$/u, '')
}

async function withContentPolicyGuidance(response: Response): Promise<Response> {
  if (response.status !== 400) return response
  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return response
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('error' in body) ||
    typeof body.error !== 'object' ||
    body.error === null ||
    !('code' in body.error) ||
    body.error.code !== 'content_policy_violation'
  ) {
    return response
  }
  return new Response(
    JSON.stringify({
      ...body,
      error: { ...body.error, message: CONTENT_POLICY_GUIDANCE },
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  )
}

/** AI SDK 负责协议；此适配器补 Windup JWT 并把固定 SDK 路径接到既有 /ai/chat。 */
export function createAgentProxyFetch({
  fetchFn = globalThis.fetch,
  getAccessToken = getApiAccessToken,
  recoverUnauthorized: recover = recoverApiUnauthorized,
}: CreateAgentProxyFetchOptions = {}): typeof globalThis.fetch {
  return async (input, init) => {
    const original = new Request(input, init)

    async function send(): Promise<Response> {
      const headers = new Headers(original.headers)
      const accessToken = getAccessToken()
      if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
      const body =
        original.method === 'GET' || original.method === 'HEAD'
          ? undefined
          : await original.clone().arrayBuffer()
      const response = await fetchFn(
        new Request(rewriteAgentProxyUrl(original.url), {
          method: original.method,
          headers,
          body,
          signal: original.signal,
          credentials: 'include',
        }),
      )
      return withContentPolicyGuidance(response)
    }

    const response = await send()
    if (response.status === 401 && (await recover())) {
      const replayed = await send()
      if (!replayed.ok) {
        console.error('[quick-start-agent] /ai/chat 失败', {
          status: replayed.status,
          requestId: replayed.headers.get(REQUEST_ID_HEADER),
        })
      }
      return replayed
    }
    if (!response.ok) {
      console.error('[quick-start-agent] /ai/chat 失败', {
        status: response.status,
        requestId: response.headers.get(REQUEST_ID_HEADER),
      })
    }
    return response
  }
}

interface CreateProductionQuickStartAgentDependenciesOptions {
  createPlanner?: () => QuickStartPlanner
  createController?: (options: CreateWorkflowControllerOptions) => WorkflowController
  prepareProject?: PrepareQuickStartProject
  workflowRunApis?: WorkflowRunApis
  generationApis?: GenerationApis
  onAsyncError?: (error: Error) => void
}

export function createProductionQuickStartAgentDependencies(
  options: CreateProductionQuickStartAgentDependenciesOptions = {},
): CreateQuickStartAgentOptions {
  let planner: QuickStartPlanner | null = null
  let plannerLoading: Promise<QuickStartPlanner> | null = null
  let generationApis = options.generationApis ?? null
  const prepareProject = options.prepareProject ?? createAutoPrepareProject(projectApis)
  const createController = options.createController ?? createWorkflowController
  const runApis = options.workflowRunApis ?? workflowRunApis
  const reportError =
    options.onAsyncError ??
    ((error: Error) => console.error('[quick-start-agent] 工作流错误', error))

  return {
    async planner(input) {
      if (!planner) {
        plannerLoading ??= options.createPlanner
          ? Promise.resolve(options.createPlanner())
          : import('@/features/quick-start-agent/planner').then(
              ({ createAiSdkQuickStartPlanner }) =>
                createAiSdkQuickStartPlanner({
                  baseURL: resolveAgentProxyBaseUrl(resolveApiBaseUrl()),
                  fetch: createAgentProxyFetch(),
                }),
            )
        planner = await plannerLoading
      }
      return planner(input)
    },
    async startCharacterGeneration(input) {
      const gameStyle = isArtStyle(input.gameStyle) ? input.gameStyle : undefined
      generationApis ??= createAuthenticatedGenerationApis()
      const controller = createController({
        workflowRunApis: runApis,
        generationApis,
        prepareProject,
        onAsyncError: reportError,
      })
      try {
        return await controller.startCharacterGeneration({
          prompt: input.prompt,
          referenceMedia: input.referenceMedia as readonly MediaReference[] | undefined,
          directionalMovement: input.directionalMovement,
          gameStyle,
          autoPixelate: input.autoPixelate,
          projectId: input.projectId,
          ...(input.suggestPixelPerfect ? { suggestPixelPerfect: true } : {}),
          ...(input.automaticDelivery
            ? {
                automaticDelivery: {
                  ...(input.actionPrompt ? { actionPrompt: input.actionPrompt } : {}),
                  ...(input.actionType ? { actionType: input.actionType } : {}),
                  ...(input.locomotion ? { locomotion: input.locomotion } : {}),
                },
              }
            : {}),
        })
      } finally {
        controller.dispose()
      }
    },
  }
}

export const productionQuickStartAgentDependencies = createProductionQuickStartAgentDependencies()
