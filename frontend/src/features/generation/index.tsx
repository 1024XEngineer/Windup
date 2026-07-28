import type { ProviderSessionStatus } from './provider-session'

export type {
  ProviderCredentialMode,
  ProviderDescriptor,
  ProviderSession,
  ProviderSessionStatus,
} from './provider-session'

/** Generation 只展示任务和 Provider 状态；真实连接由后端契约接入。 */
export interface GenerationProps {
  /** 当前前端 WorkflowRun ID，仅用于页面编排和任务关联。 */
  runId: string
  /** 要生成的 Action ID；生成母版等非动作任务可以省略。 */
  actionId?: string
  /** 当前 Provider 会话状态；省略时按尚未配置展示。 */
  providerStatus?: ProviderSessionStatus
  /** 后端确认动作生成完成后触发，并返回对应 Action ID。 */
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
