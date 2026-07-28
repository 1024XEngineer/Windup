import type { ProviderSessionStatus } from './provider-session'

export type {
  ProviderCredentialMode,
  ProviderDescriptor,
  ProviderSession,
  ProviderSessionStatus,
} from './provider-session'

/** Generation 只展示任务和 Provider 状态；真实连接由后端契约接入。 */
export interface GenerationProps {
  runId: string
  actionId?: string
  providerStatus?: ProviderSessionStatus
  onGenerated?: (actionId: string) => void
}

export function Generation({ runId, actionId, providerStatus = 'unconfigured' }: GenerationProps) {
  const message = {
    unconfigured: 'Provider Session 尚未连接。',
    connecting: '正在验证 Provider Session…',
    ready: 'Provider Session 已连接，等待生成任务。',
    failed: 'Provider Session 连接失败，请检查后端错误。',
  }[providerStatus]

  return (
    <section className="space-y-3 border border-dashed border-slate-300 p-6 text-sm">
      <p className="font-medium">AI 生成</p>
      <p className="text-slate-500">
        工作流 {runId}
        {actionId ? ` · 动作 ${actionId}` : ''}
      </p>
      <p className="text-slate-500">{message}</p>
      <p className="text-xs text-slate-400">
        真实 Provider、Job 和增量产物由后端接口接入；当前不会模拟生成成功。
      </p>
    </section>
  )
}
