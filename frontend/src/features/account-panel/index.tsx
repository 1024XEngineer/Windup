import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { useAuthSession } from '@/features/auth-session'
import { sanitizeInternalPath } from '@/shared/navigation'

type AccountMode = 'code' | 'password' | 'register'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_PATTERN = /^\d{6}$/
const SUCCESS_NAVIGATION_DELAY_MS = 900

const modeCopy: Record<
  AccountMode,
  { tab: string; title: string; description: string; submit: string }
> = {
  code: {
    tab: '邮箱验证码',
    title: '登录 Windup',
    description: '用邮箱验证码继续，免去记忆密码。',
    submit: '登录',
  },
  password: {
    tab: '密码登录',
    title: '登录 Windup',
    description: '用邮箱和密码直接登录。',
    submit: '登录',
  },
  register: {
    tab: '注册',
    title: '创建 Windup 账号',
    description: '创建账号后即可继续保存与管理角色资产。',
    submit: '创建账号',
  },
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

function emailKey(email: string): string {
  return email.trim().toLowerCase()
}

/** 查询参数驱动的认证入口，不创建独立登录页面。 */
export function AccountPanel() {
  const [searchParams] = useSearchParams()
  if (searchParams.get('account') !== 'login') return null

  return <AccountPanelDialog />
}

/** 只有面板真正打开时才读取会话，关闭状态不把认证 Context 强加给应用外壳。 */
function AccountPanelDialog() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const session = useAuthSession()
  const [mode, setMode] = useState<AccountMode>('code')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cooldowns, setCooldowns] = useState<Map<string, number>>(() => new Map())
  const [now, setNow] = useState(Date.now())
  const emailInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const navigationTimerRef = useRef<number | null>(null)
  const dismissedRef = useRef(false)
  const titleId = useId()
  const descriptionId = useId()
  const emailId = useId()
  const nicknameId = useId()
  const passwordId = useId()
  const codeId = useId()
  const copy = modeCopy[mode]
  const passwordChanged =
    session.state.status === 'guest' && session.state.reason === 'password-changed'
  const normalizedEmail = email.trim()
  const cooldownSeconds = Math.max(
    0,
    Math.ceil(((cooldowns.get(emailKey(email)) ?? 0) - now) / 1_000),
  )

  const returnTarget = useMemo(
    () => sanitizeInternalPath(searchParams.get('returnTo')) ?? '/',
    [searchParams],
  )

  useEffect(() => {
    if (cooldowns.size === 0) return
    const timer = window.setInterval(() => {
      const currentTime = Date.now()
      setNow(currentTime)
      setCooldowns((previous) => {
        const active = new Map([...previous].filter(([, expiresAt]) => expiresAt > currentTime))
        return active.size === previous.size ? previous : active
      })
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [cooldowns.size])

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const frame = window.requestAnimationFrame(() => emailInputRef.current?.focus())
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [])

  useEffect(() => {
    // StrictMode 会用一次 setup → cleanup → setup 检查副作用；第二次 setup 代表组件仍然存活。
    dismissedRef.current = false
    return () => {
      dismissedRef.current = true
      if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
    }
  }, [])

  function close() {
    dismissedRef.current = true
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
    const next = new URLSearchParams(searchParams)
    next.delete('account')
    setSearchParams(next, { replace: true })
  }

  function selectMode(nextMode: AccountMode) {
    setMode(nextMode)
    setError(null)
    setSuccess(null)
    window.requestAnimationFrame(() => emailInputRef.current?.focus())
  }

  async function sendCode() {
    if (isSendingCode || cooldownSeconds > 0) return
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('请输入有效邮箱地址')
      return
    }

    setError(null)
    setSuccess(null)
    setIsSendingCode(true)
    try {
      await session.sendCode({
        email: normalizedEmail,
        purpose: mode === 'register' ? 'register' : 'login',
      })
      const sentAt = Date.now()
      setNow(sentAt)
      setCooldowns((previous) => new Map(previous).set(emailKey(normalizedEmail), sentAt + 60_000))
      setSuccess('验证码已发送，请在 5 分钟内使用。')
    } catch (sendError) {
      setError(errorMessage(sendError))
    } finally {
      setIsSendingCode(false)
    }
  }

  function validate(): string | null {
    if (!EMAIL_PATTERN.test(normalizedEmail)) return '请输入有效邮箱地址'
    if (mode !== 'code' && (password.length < 8 || password.length > 128)) {
      return '密码需为 8–128 位'
    }
    if (mode !== 'password' && !CODE_PATTERN.test(code)) return '验证码需为 6 位数字'
    if (mode === 'register' && nickname.length > 50) return '昵称不能超过 50 个字符'
    return null
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setSuccess(null)
    setIsSubmitting(true)
    try {
      let successMessage: string
      if (mode === 'code') {
        await session.loginByCode({ email: normalizedEmail, code })
        successMessage = '登录成功。如果这是你首次使用该邮箱，我们已为你创建账号。'
      } else if (mode === 'password') {
        await session.login({ email: normalizedEmail, password })
        successMessage = '登录成功，正在继续。'
      } else {
        await session.register({
          email: normalizedEmail,
          password,
          code,
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
        })
        successMessage = '账号已创建，正在继续。'
      }

      if (dismissedRef.current) return
      setSuccess(successMessage)
      navigationTimerRef.current = window.setTimeout(
        () => navigate(returnTarget, { replace: true }),
        SUCCESS_NAVIGATION_DELAY_MS,
      )
    } catch (submitError) {
      if (dismissedRef.current) return
      setError(errorMessage(submitError))
      setIsSubmitting(false)
    }
  }

  function onDocumentKeyDown(event: globalThis.KeyboardEvent) {
    if (event.key === 'Escape') close()
  }

  useEffect(() => {
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  })

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) close()
  }

  const fieldClass =
    'min-h-11 w-full rounded-xl border border-[#98a39b] bg-white px-3.5 text-base text-[#1c231e] outline-none transition-[border-color,box-shadow] placeholder:text-[#8a948c] focus:border-[#284331] focus:ring-2 focus:ring-[#284331]/18 disabled:cursor-not-allowed disabled:bg-[#f1f3f1]'
  const tabClass =
    'min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331]'

  return (
    <div
      className="account-dialog-backdrop fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#101713]/52 p-4 backdrop-blur-[2px]"
      onMouseDown={closeFromBackdrop}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={trapFocus}
        className="account-dialog-panel relative my-auto w-full max-w-[27rem] rounded-[1.5rem] border border-[#284331]/18 bg-[#f8faf8] p-5 text-[#1c231e] shadow-[0_24px_72px_rgba(16,23,19,0.24)] sm:p-7"
      >
        <button
          type="button"
          onClick={close}
          aria-label="关闭账号面板"
          className="absolute top-4 right-4 inline-grid min-h-11 min-w-11 place-items-center rounded-full text-xl text-[#5b655d] transition-colors hover:bg-[#e7ece8] hover:text-[#1c231e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331]"
        >
          <span aria-hidden="true">×</span>
        </button>

        <div className="pr-10">
          <p className="mb-2 text-[11px] font-bold tracking-[0.16em] text-[#617064] uppercase">
            Windup account
          </p>
          <h2
            id={titleId}
            className="font-serif text-2xl leading-tight font-semibold sm:text-[1.75rem]"
          >
            {copy.title}
          </h2>
          <p id={descriptionId} className="mt-2 text-sm leading-6 text-[#68736a]">
            {copy.description}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="账号操作"
          className="mt-6 flex gap-1 rounded-xl bg-[#e5e9e5] p-1"
        >
          {(Object.keys(modeCopy) as AccountMode[]).map((itemMode) => (
            <button
              key={itemMode}
              type="button"
              role="tab"
              aria-selected={mode === itemMode}
              onClick={() => selectMode(itemMode)}
              className={`${tabClass} ${
                mode === itemMode
                  ? 'bg-white text-[#284331] shadow-[0_1px_3px_rgba(16,23,19,0.12)]'
                  : 'text-[#68736a] hover:bg-white/55 hover:text-[#34483a]'
              }`}
            >
              {modeCopy[itemMode].tab}
            </button>
          ))}
        </div>

        {passwordChanged && (
          <p
            role="status"
            className="mt-5 rounded-xl border border-[#78927e]/40 bg-[#eef5ef] px-3.5 py-3 text-sm leading-6 text-[#34533c]"
          >
            密码修改成功，请重新登录
          </p>
        )}

        <form
          className={`${passwordChanged ? 'mt-4' : 'mt-5'} grid gap-4`}
          onSubmit={submit}
          noValidate
        >
          <label htmlFor={emailId} className="grid gap-1.5 text-sm font-semibold text-[#344039]">
            邮箱
            <input
              id={emailId}
              ref={emailInputRef}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting}
              className={fieldClass}
              placeholder="name@example.com"
            />
          </label>

          {mode === 'register' && (
            <div className="grid gap-1.5 text-sm font-semibold text-[#344039]">
              <label htmlFor={nicknameId}>昵称（选填）</label>
              <input
                id={nicknameId}
                type="text"
                autoComplete="nickname"
                maxLength={51}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                disabled={isSubmitting}
                className={fieldClass}
                placeholder="怎么称呼你"
              />
              <span className="text-xs font-normal text-[#778078]">最多 50 个字符</span>
            </div>
          )}

          {mode !== 'code' && (
            <div className="grid gap-1.5 text-sm font-semibold text-[#344039]">
              <span className="flex items-center justify-between gap-4">
                <label htmlFor={passwordId}>密码</label>
                {mode === 'password' && (
                  <span aria-disabled="true" className="text-xs font-normal text-[#778078]">
                    <span>忘记密码</span> · <span>暂未开放</span>
                  </span>
                )}
              </span>
              <input
                id={passwordId}
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
                className={fieldClass}
                placeholder="8–128 位"
              />
            </div>
          )}

          {mode !== 'password' && (
            <div className="grid gap-1.5 text-sm font-semibold text-[#344039]">
              <label htmlFor={codeId}>验证码</label>
              <span className="flex items-stretch gap-2">
                <input
                  id={codeId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  disabled={isSubmitting}
                  className={fieldClass}
                  placeholder="6 位数字"
                />
                <button
                  type="button"
                  onClick={() => void sendCode()}
                  disabled={isSendingCode || isSubmitting || cooldownSeconds > 0}
                  className="min-h-11 min-w-[7.25rem] rounded-xl border border-[#607067] bg-[#eef2ef] px-3 text-sm font-semibold text-[#34483a] transition-colors hover:bg-[#e1e8e3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331] disabled:cursor-not-allowed disabled:border-[#bbc2bc] disabled:text-[#858d87]"
                >
                  {isSendingCode
                    ? '正在发送…'
                    : cooldownSeconds > 0
                      ? `${cooldownSeconds} 秒后重发`
                      : '发送验证码'}
                </button>
              </span>
            </div>
          )}

          {mode === 'code' && (
            <p className="rounded-xl border border-[#97a99b]/45 bg-[#edf3ee] px-3.5 py-3 text-sm leading-6 text-[#46564b]">
              未注册的邮箱将在验证后自动创建账号。
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-[#b76b63]/35 bg-[#fff5f3] px-3.5 py-3 text-sm leading-6 text-[#8a3932]"
            >
              {error}
            </p>
          )}
          {success && (
            <p
              role="status"
              className="rounded-xl border border-[#78927e]/40 bg-[#eef5ef] px-3.5 py-3 text-sm leading-6 text-[#34533c]"
            >
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 min-h-12 rounded-xl bg-[#284331] px-4 text-base font-semibold text-white shadow-[0_8px_20px_rgba(40,67,49,0.18)] transition-[background-color,transform] hover:bg-[#1f3627] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331] disabled:cursor-not-allowed disabled:bg-[#77857b] disabled:shadow-none"
          >
            {isSubmitting ? '正在处理…' : copy.submit}
          </button>
        </form>
      </div>
    </div>
  )
}
