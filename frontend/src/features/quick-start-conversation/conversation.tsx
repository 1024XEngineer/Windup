import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUp } from '@phosphor-icons/react'

import type { QuickStartConversationClient, QuickStartConversationMessage } from './api'

export interface QuickStartConversationProps {
  client: QuickStartConversationClient
  draft: string
  onDraftChange(value: string): void
  onConfirm(prompt: string): Promise<void>
  accessory?: ReactNode
  onStarted?(): void
}

type ConversationStatus = 'idle' | 'requesting' | 'confirming'
type ConversationEntry = QuickStartConversationMessage & { modelContent?: string }

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}

export function QuickStartConversation({
  client,
  draft,
  onDraftChange,
  onConfirm,
  accessory,
  onStarted,
}: QuickStartConversationProps) {
  const [messages, setMessages] = useState<ConversationEntry[]>([])
  const [suggestion, setSuggestion] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [clarificationPending, setClarificationPending] = useState(false)
  const [status, setStatus] = useState<ConversationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      request.current?.abort()
    },
    [],
  )

  async function requestResponse(content: string) {
    if (status !== 'idle') return
    const controller = new AbortController()
    request.current = controller
    setStatus('requesting')
    setError(null)
    onStarted?.()
    const nextEntries: ConversationEntry[] = [...messages, { role: 'user', content }]
    const nextMessages: QuickStartConversationMessage[] = [
      ...messages.map(({ role, content: displayContent, modelContent }) => ({
        role,
        content: modelContent ?? displayContent,
      })),
      { role: 'user', content },
    ]
    try {
      const result = await client.respond(nextMessages, controller.signal)
      if (controller.signal.aborted) return
      const assistant: ConversationEntry = {
        role: 'assistant',
        content: result.reply,
        ...(result.type === 'prompt_suggestion' ? { modelContent: JSON.stringify(result) } : {}),
      }
      setMessages([...nextEntries, assistant])
      onDraftChange('')
      if (result.type === 'prompt_suggestion') {
        setSuggestion(result.optimizedPrompt)
        setWarnings(result.warnings)
        setClarificationPending(false)
      } else {
        setSuggestion('')
        setWarnings([])
        setClarificationPending(true)
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause, '暂时无法理解这段描述'))
    } finally {
      if (request.current === controller) request.current = null
      if (!controller.signal.aborted) setStatus('idle')
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content) return
    void requestResponse(content)
  }

  function cancelRequest() {
    const controller = request.current
    if (!controller) return
    request.current = null
    controller.abort()
    setStatus('idle')
    setError(null)
  }

  async function confirm() {
    const prompt = suggestion.trim()
    if (!prompt || status !== 'idle') return
    setStatus('confirming')
    setError(null)
    try {
      await onConfirm(prompt)
    } catch (cause) {
      setError(errorMessage(cause, '创建失败，请稍后重试'))
      setStatus('idle')
    }
  }

  return (
    <div className="grid gap-3">
      {messages.length > 0 ? (
        <div aria-live="polite" className="grid max-h-52 gap-2 overflow-y-auto pr-1">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`max-w-[88%] rounded-xl px-4 py-2.5 text-sm leading-6 ${
                message.role === 'user'
                  ? 'ml-auto bg-app-accent text-app-on-accent'
                  : 'border border-app-line bg-app-surface text-app-ink-soft'
              }`}
            >
              {message.content}
            </div>
          ))}
        </div>
      ) : null}

      {suggestion ? (
        <section className="rounded-xl border border-app-accent/30 bg-app-surface p-4 shadow-app-card">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-serif text-lg text-app-ink">优化后的角色描述</h2>
            <span className="font-mono text-[10px] font-bold tracking-[0.12em] text-app-accent">
              READY
            </span>
          </div>
          <textarea
            aria-label="优化后的角色描述"
            value={suggestion}
            onChange={(event) => setSuggestion(event.target.value)}
            className="mt-3 min-h-24 w-full resize-y rounded-lg border border-app-line-strong bg-app-surface-raised p-3 text-sm leading-6 text-app-ink outline-none focus:border-app-accent"
          />
          {warnings.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-app-warning">
              {warnings.map((warning) => (
                <li key={warning}>· {warning}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!suggestion.trim() || status !== 'idle'}
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-app-accent px-4 text-sm font-bold text-app-on-accent disabled:opacity-45"
          >
            {status === 'confirming' ? '正在创建…' : '按此生成角色'}
          </button>
        </section>
      ) : null}

      {clarificationPending ? (
        <button
          type="button"
          onClick={() => void requestResponse('跳过追问，请基于现有信息直接整理提示词。')}
          disabled={status !== 'idle'}
          className="w-fit text-xs font-semibold text-app-muted underline-offset-4 hover:text-app-accent hover:underline disabled:opacity-45"
        >
          跳过追问
        </button>
      ) : null}

      <form
        onSubmit={send}
        className="grid items-center gap-1.5 rounded-xl border border-app-line-strong bg-app-surface-raised p-1.5 shadow-app-panel transition-shadow focus-within:border-app-accent focus-within:shadow-[var(--shadow-app-composer-focus)] sm:grid-cols-[1fr_auto_auto]"
      >
        <label className="min-w-0">
          <span className="sr-only">创作指令</span>
          <input
            aria-label="创作指令"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={messages.length > 0 ? '继续补充角色信息…' : '描述角色的外形、身份和气质…'}
            className="h-10 w-full min-w-0 border-0 bg-transparent px-3 text-[15px] text-app-ink outline-none placeholder:text-app-faint"
          />
        </label>
        {accessory}
        {status === 'requesting' ? (
          <button
            type="button"
            aria-label="取消请求"
            onClick={cancelRequest}
            className="inline-flex h-10 items-center rounded-lg border border-app-line-strong px-4 text-sm font-bold text-app-muted hover:border-app-accent hover:text-app-accent"
          >
            取消
          </button>
        ) : (
          <button
            type="submit"
            aria-label="发送描述"
            disabled={!draft.trim() || status !== 'idle'}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-app-accent px-4 text-sm font-bold whitespace-nowrap text-app-on-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            发送
            <ArrowUp aria-hidden="true" size={16} weight="bold" />
          </button>
        )}
      </form>
      {error ? (
        <p role="alert" className="rounded-xl bg-app-danger px-4 py-3 text-sm text-app-danger-soft">
          {error}
        </p>
      ) : null}
    </div>
  )
}
