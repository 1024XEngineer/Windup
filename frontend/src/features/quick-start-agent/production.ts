import {
  isArtStyle,
  createAuthenticatedGenerationApis,
  projectApis,
  workflowRunApis,
  type GenerationApis,
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
      return fetchFn(
        new Request(rewriteAgentProxyUrl(original.url), {
          method: original.method,
          headers,
          body,
          signal: original.signal,
          credentials: 'include',
        }),
      )
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
          directionalMovement: input.directionalMovement,
          gameStyle,
          ...(input.automaticDelivery
            ? {
                automaticDelivery: {
                  ...(input.actionPrompt ? { actionPrompt: input.actionPrompt } : {}),
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
