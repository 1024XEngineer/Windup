import { getApiAccessToken, recoverApiUnauthorized, resolveApiBaseUrl } from '@/shared/api'

import { createQuickStartConversationClient, type QuickStartConversationClient } from './api'

export type {
  QuickStartConversationClient,
  QuickStartConversationMessage,
  QuickStartConversationResult,
} from './api'
export { QuickStartConversation } from './conversation'

/** 只在发送时解析 API 地址，避免未配置环境在模块加载阶段阻断 Quick Start。 */
export const quickStartConversationClient: QuickStartConversationClient = {
  respond(messages, signal) {
    return createQuickStartConversationClient({
      baseUrl: resolveApiBaseUrl(),
      getAccessToken: getApiAccessToken,
      recoverUnauthorized: recoverApiUnauthorized,
    }).respond(messages, signal)
  },
}
