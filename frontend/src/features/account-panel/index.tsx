import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import {
  ArrowLeft,
  ArrowsClockwise,
  EnvelopeSimple,
  Eye,
  EyeClosed,
  Keyhole,
  SealCheck,
  UserCircle,
  X,
  type Icon,
} from '@phosphor-icons/react'
import { useNavigate, useSearchParams } from 'react-router'

import { useAuthSession } from '@/features/auth-session'
import { sanitizeInternalPath } from '@/shared/navigation'
import { KineticCopy, type KineticCopyPhase } from '@/shared/ui'
import messengerPigeon from '@/assets/auth/illustrations/messenger-pigeon.webp'

import './account-panel.css'

type AccountEntry = 'login' | 'register'
type LoginMode = 'code' | 'password'
type MotionDirection = 'forward' | 'backward'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_PATTERN = /^\d{6}$/
const INVITE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4,16}$/i
const SUCCESS_NAVIGATION_DELAY_MS = 900
const AUTH_EXIT_DURATION_MS = 520

const loginModeCopy: Record<LoginMode, { tab: string; submit: string }> = {
  code: {
    tab: '邮箱验证码',
    submit: '登录',
  },
  password: {
    tab: '密码登录',
    submit: '登录',
  },
}

const registrationStepCopy = [
  {
    title: '欢迎来到 Windup',
    description: '从一个角色开始，慢慢搭建属于你的世界。',
  },
  {
    title: '为账号加一道保护',
    description: '设置 8–128 位密码，方便安全地回到你的创作。',
  },
  {
    title: '留下你的称呼',
    description: '昵称可以稍后修改，也可以暂时跳过。',
  },
  {
    title: '确认你的邮箱',
    description: '输入邮件中的 6 位验证码，完成账号创建。',
  },
] as const

const registrationWelcomeMotionCopy = [
  ['从一个角色开始，', '慢慢搭建属于你的世界。'],
  ['让第一个念头留下来，', '它会慢慢长成一个角色。'],
  ['世界还没有名字，', '先从这里写下第一笔。'],
] as const

const loginWelcomeCopy = {
  title: '欢迎回来。',
  description: '继续搭建属于你的角色世界。',
}

const loginMotionCopy = [
  ['继续搭建，', '属于你的角色世界。'],
  ['你的角色还在这里，', '接着完成上次的创作。'],
  ['从上一次确认出发，', '让灵感继续向前。'],
] as const

const REGISTER_STEP_COUNT = 4
const AUTH_ICON_PROPS = { weight: 'light' as const }
const AUTH_FIELD_CLASS = 'auth-screen-field w-full outline-none disabled:cursor-not-allowed'

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

function emailKey(email: string): string {
  return email.trim().toLowerCase()
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function KineticTitle({ id, text, emphasis }: { id: string; text: string; emphasis?: string }) {
  const emphasisStart = emphasis ? text.indexOf(emphasis) : -1
  return (
    <h2 id={id} aria-label={text} className="auth-register-title">
      <span className="auth-title-line" aria-hidden="true">
        {Array.from(text).map((character, index) => (
          <span
            key={`${character}-${index}`}
            className={`auth-title-character ${
              emphasisStart >= 0 &&
              index >= emphasisStart &&
              index < emphasisStart + emphasis!.length
                ? 'auth-title-character-emphasis'
                : ''
            }`}
            style={{ '--auth-character-index': index } as CSSProperties}
          >
            {character === ' ' ? '\u00a0' : character}
          </span>
        ))}
      </span>
    </h2>
  )
}

type AuthFieldProps = Omit<ComponentPropsWithoutRef<'input'>, 'onChange'> & {
  label: string
  icon: Icon
  onValueChange: (value: string) => void
  variant?: 'field' | 'password' | 'code'
  action?: ReactNode
  inputRef?: Ref<HTMLInputElement>
}

function AuthField({
  id,
  label,
  icon: FieldIcon,
  onValueChange,
  variant = 'field',
  action,
  inputRef,
  ...inputProps
}: AuthFieldProps) {
  const Shell = variant === 'password' ? 'div' : 'span'
  const variantClass =
    variant === 'password'
      ? 'auth-password-field'
      : variant === 'code'
        ? 'auth-screen-code-field'
        : ''

  return (
    <div className="auth-screen-label grid gap-2 text-sm font-semibold">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Shell className={`auth-register-field-shell ${variantClass}`}>
        <FieldIcon {...AUTH_ICON_PROPS} />
        <input
          ref={inputRef}
          id={id}
          onChange={(event) => onValueChange(event.target.value)}
          className={AUTH_FIELD_CLASS}
          {...inputProps}
        />
        {action}
      </Shell>
    </div>
  )
}

function PasswordVisibilityButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const VisibilityIcon = visible ? EyeClosed : Eye
  return (
    <button
      type="button"
      className="auth-password-visibility"
      onClick={onClick}
      aria-label={visible ? '隐藏密码' : '显示密码'}
    >
      <VisibilityIcon
        key={visible ? 'closed' : 'open'}
        className="auth-visibility-glyph"
        {...AUTH_ICON_PROPS}
      />
    </button>
  )
}

/** 查询参数驱动的认证入口，不创建独立登录页面。 */
export function AccountPanel() {
  const [searchParams] = useSearchParams()
  const requestedEntry = searchParams.get('account')
  if (requestedEntry !== 'login' && requestedEntry !== 'register') return null

  const inviteCode = searchParams.get('invite')?.trim().toUpperCase() ?? ''
  const entry: AccountEntry =
    requestedEntry === 'register' && INVITE_CODE_PATTERN.test(inviteCode) ? 'register' : 'login'

  return (
    <AccountPanelDialog
      key={`${entry}:${inviteCode}`}
      entry={entry}
      inviteCode={entry === 'register' ? inviteCode : null}
    />
  )
}

/** 只有面板真正打开时才读取会话，关闭状态不把认证 Context 强加给应用外壳。 */
function AccountPanelDialog({
  entry,
  inviteCode,
}: {
  entry: AccountEntry
  inviteCode: string | null
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const session = useAuthSession()
  const [mode, setMode] = useState<LoginMode>('code')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [registerStep, setRegisterStep] = useState(0)
  const [motionDirection, setMotionDirection] = useState<MotionDirection>('forward')
  const [copyIndex, setCopyIndex] = useState(0)
  const [copyPhase, setCopyPhase] = useState<KineticCopyPhase>('entering')
  const [isExiting, setIsExiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cooldowns, setCooldowns] = useState<Map<string, number>>(() => new Map())
  const [now, setNow] = useState(Date.now())
  const emailInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const navigationTimerRef = useRef<number | null>(null)
  const copyTransitionTimerRef = useRef<number | null>(null)
  const copyRestTimerRef = useRef<number | null>(null)
  const exitTimerRef = useRef<number | null>(null)
  const dismissedRef = useRef(false)
  const closeRef = useRef<() => void>(() => undefined)
  const titleId = useId()
  const descriptionId = useId()
  const emailId = useId()
  const nicknameId = useId()
  const passwordId = useId()
  const codeId = useId()
  const isRegister = entry === 'register'
  const shouldShowMotionCopy = !isRegister || registerStep === 0
  const motionCopy = isRegister ? registrationWelcomeMotionCopy : loginMotionCopy
  const activeMotionCopy = motionCopy[copyIndex % motionCopy.length]
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
    setCopyIndex(0)
    setCopyPhase('entering')
    if (!shouldShowMotionCopy) return
    if (prefersReducedMotion()) return
    copyRestTimerRef.current = window.setTimeout(() => setCopyPhase('resting'), 760)
    const timer = window.setInterval(() => {
      setCopyPhase('exiting')
      copyTransitionTimerRef.current = window.setTimeout(() => {
        setCopyIndex((current) => (current + 1) % motionCopy.length)
        setCopyPhase('entering')
        copyRestTimerRef.current = window.setTimeout(() => setCopyPhase('resting'), 760)
      }, 460)
    }, 4_200)
    return () => {
      window.clearInterval(timer)
      if (copyTransitionTimerRef.current) window.clearTimeout(copyTransitionTimerRef.current)
      if (copyRestTimerRef.current) window.clearTimeout(copyRestTimerRef.current)
    }
  }, [entry, registerStep, motionCopy.length, shouldShowMotionCopy])

  useEffect(() => {
    // StrictMode 会用一次 setup → cleanup → setup 检查副作用；第二次 setup 代表组件仍然存活。
    dismissedRef.current = false
    return () => {
      dismissedRef.current = true
      if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current)
    }
  }, [])

  function leaveWithAnimation(action: () => void) {
    if (isExiting) return
    dismissedRef.current = true
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
    if (copyTransitionTimerRef.current) window.clearTimeout(copyTransitionTimerRef.current)
    if (copyRestTimerRef.current) window.clearTimeout(copyRestTimerRef.current)
    setCopyPhase('exiting')
    setIsExiting(true)

    const duration = prefersReducedMotion() ? 0 : AUTH_EXIT_DURATION_MS
    exitTimerRef.current = window.setTimeout(action, duration)
  }

  function close() {
    leaveWithAnimation(() => {
      const next = new URLSearchParams(searchParams)
      next.delete('account')
      next.delete('invite')
      setSearchParams(next, { replace: true })
    })
  }
  closeRef.current = close

  function selectMode(nextMode: LoginMode) {
    if (nextMode === mode) return
    setMotionDirection(nextMode === 'password' ? 'forward' : 'backward')
    setMode(nextMode)
    setError(null)
    setSuccess(null)
    window.requestAnimationFrame(() => emailInputRef.current?.focus())
  }

  /*
  function switchEntry(nextEntry: AccountEntry) {
    leaveWithAnimation(() => {
      const next = new URLSearchParams(searchParams)
      next.set('account', nextEntry)
      setSearchParams(next, { replace: true })
    })
  }
  */

  async function sendCode(): Promise<boolean> {
    if (isSendingCode || cooldownSeconds > 0) return false
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError('请输入有效邮箱地址')
      return false
    }

    setError(null)
    setSuccess(null)
    setIsSendingCode(true)
    try {
      await session.sendCode({
        email: normalizedEmail,
        purpose: isRegister ? 'register' : 'login',
      })
      const sentAt = Date.now()
      setNow(sentAt)
      setCooldowns((previous) => new Map(previous).set(emailKey(normalizedEmail), sentAt + 60_000))
      setSuccess('验证码已发送，请在 5 分钟内使用。')
      return true
    } catch (sendError) {
      setError(errorMessage(sendError))
      return false
    } finally {
      setIsSendingCode(false)
    }
  }

  function validateLogin(): string | null {
    if (!EMAIL_PATTERN.test(normalizedEmail)) return '请输入有效邮箱地址'
    if (mode === 'password' && (password.length < 8 || password.length > 128)) {
      return '密码需为 8–128 位'
    }
    if (mode === 'code' && !CODE_PATTERN.test(code)) return '验证码需为 6 位数字'
    return null
  }

  function validateRegistration(): string | null {
    if (!EMAIL_PATTERN.test(normalizedEmail)) return '请输入有效邮箱地址'
    if (password.length < 8 || password.length > 128) return '密码需为 8–128 位'
    if (nickname.length > 50) return '昵称不能超过 50 个字符'
    if (!CODE_PATTERN.test(code)) return '验证码需为 6 位数字'
    return null
  }

  async function continueRegistration() {
    let validationError: string | null = null
    if (registerStep === 0 && !EMAIL_PATTERN.test(normalizedEmail)) {
      validationError = '请输入有效邮箱地址'
    } else if (registerStep === 1 && (password.length < 8 || password.length > 128)) {
      validationError = '密码需为 8–128 位'
    } else if (registerStep === 2 && nickname.length > 50) {
      validationError = '昵称不能超过 50 个字符'
    }

    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setSuccess(null)
    if (registerStep === 2) {
      if (cooldownSeconds === 0 && !(await sendCode())) return
    }
    setMotionDirection('forward')
    setRegisterStep((current) => Math.min(current + 1, REGISTER_STEP_COUNT - 1))
  }

  function returnToPreviousRegistrationStep() {
    setError(null)
    setSuccess(null)
    setMotionDirection('backward')
    setRegisterStep((current) => Math.max(0, current - 1))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting || isSendingCode) return

    if (isRegister && registerStep < REGISTER_STEP_COUNT - 1) {
      await continueRegistration()
      return
    }

    const validationError = isRegister ? validateRegistration() : validateLogin()
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setSuccess(null)
    setIsSubmitting(true)
    try {
      let successMessage: string
      if (isRegister) {
        if (!inviteCode) throw new Error('邀请链接无效')
        await session.register({
          email: normalizedEmail,
          password,
          code,
          inviteCode,
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
        })
        successMessage = '账号已创建，正在继续。'
      } else if (mode === 'code') {
        await session.loginByCode({ email: normalizedEmail, code })
        // 内测不自动建号。重新开放注册时改回：
        // successMessage = '登录成功。如果这是你首次使用该邮箱，我们已为你创建账号。'
        successMessage = '登录成功，正在继续。'
      } else {
        await session.login({ email: normalizedEmail, password })
        successMessage = '登录成功，正在继续。'
      }

      if (dismissedRef.current) return
      setSuccess(successMessage)
      navigationTimerRef.current = window.setTimeout(
        () => leaveWithAnimation(() => navigate(returnTarget, { replace: true })),
        SUCCESS_NAVIGATION_DELAY_MS - AUTH_EXIT_DURATION_MS,
      )
    } catch (submitError) {
      if (dismissedRef.current) return
      setError(errorMessage(submitError))
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    function onDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [])

  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
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

  const tabClass = 'auth-screen-tab min-h-11 flex-1 px-2 text-sm font-semibold'
  const submitLabel = isRegister ? '创建账号' : loginModeCopy[mode].submit
  const RegisterFieldIcon: Icon = [EnvelopeSimple, Keyhole, UserCircle, SealCheck][registerStep]
  const registerCopy = registrationStepCopy[registerStep]
  const titleCopy = isRegister ? registerCopy.title : loginWelcomeCopy.title
  const descriptionCopy = isRegister ? registerCopy.description : loginWelcomeCopy.description
  const dialogLabel = isRegister ? '创建 Windup 账号' : '登录 Windup'
  const submitContent = isSubmitting
    ? '正在处理…'
    : isSendingCode
      ? '正在发送…'
      : isRegister && registerStep < REGISTER_STEP_COUNT - 1
        ? '继续'
        : submitLabel
  const feedback = (
    <>
      {error && (
        <p role="alert" className="auth-screen-toast auth-screen-toast-error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="auth-screen-toast auth-screen-toast-success">
          {success}
        </p>
      )}
    </>
  )

  return (
    <div
      className={`auth-screen auth-screen-animated fixed inset-0 z-[70] overflow-y-auto ${
        isExiting ? 'auth-screen-exiting' : ''
      } ${isRegister ? 'auth-register-screen' : ''}`}
    >
      <div
        className="auth-screen-brand fixed z-[2] flex items-center gap-[0.7rem]"
        aria-label="Windup"
      >
        <img src="/windup-mark.svg" alt="" className="size-[1.65rem]" />
        <strong className="font-serif text-2xl leading-none tracking-[-0.025em]">Windup</strong>
      </div>

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        aria-describedby={descriptionId}
        onKeyDown={trapFocus}
        className="auth-screen-dialog relative z-[1] mx-auto grid min-h-[100dvh] w-full max-w-[34rem] place-content-center px-5 pt-[5.5rem] pb-[5.5rem] sm:px-0"
      >
        <button
          type="button"
          onClick={close}
          disabled={isExiting}
          aria-label="关闭账号面板"
          className="auth-screen-close fixed z-[3] grid size-11 place-items-center rounded-full border border-transparent text-2xl leading-none text-[#777770]"
        >
          <X {...AUTH_ICON_PROPS} />
        </button>

        <div className="auth-register-content relative z-[2] w-full">
          <figure
            className="auth-messenger-bird auth-messenger-bird-back pointer-events-none absolute z-[1] m-0 origin-[68%_56%]"
            aria-hidden="true"
          >
            <img
              src={messengerPigeon}
              alt=""
              className="block h-auto w-full saturate-[0.8] contrast-[0.99]"
            />
          </figure>
          <figure
            className="auth-messenger-bird auth-messenger-bird-front pointer-events-none absolute z-[4] m-0 origin-[68%_56%] [clip-path:polygon(56%_31%,100%_31%,100%_100%,59%_100%,52%_65%)]"
            aria-hidden="true"
          >
            <img
              src={messengerPigeon}
              alt=""
              className="block h-auto w-full saturate-[0.8] contrast-[0.99]"
            />
          </figure>
          <div className="auth-screen-intro relative z-[3] text-center">
            <KineticTitle
              id={titleId}
              text={titleCopy}
              emphasis={isRegister && registerStep === 0 ? 'Windup' : undefined}
            />
            <p id={descriptionId} className="sr-only">
              {descriptionCopy}
            </p>
            {shouldShowMotionCopy && (
              <div className="auth-register-description mx-auto mt-3">
                <KineticCopy
                  lines={activeMotionCopy}
                  copyKey={`${entry}-${registerStep}-${copyIndex}`}
                  phase={copyPhase}
                />
              </div>
            )}
            {isRegister && registerStep > 0 && (
              <p className="auth-register-step-description mx-auto mt-3 max-w-[30rem]">
                {descriptionCopy}
              </p>
            )}
          </div>

          {!isRegister && (
            <div
              role="tablist"
              aria-label="账号操作"
              data-mode={mode}
              className="auth-screen-tabs mt-7 flex"
            >
              {(Object.keys(loginModeCopy) as LoginMode[]).map((itemMode) => (
                <button
                  key={itemMode}
                  type="button"
                  role="tab"
                  aria-selected={mode === itemMode}
                  onClick={() => selectMode(itemMode)}
                  className={`${tabClass} ${mode === itemMode ? 'auth-screen-tab-active' : ''}`}
                >
                  {loginModeCopy[itemMode].tab}
                </button>
              ))}
              <span className="auth-screen-tab-indicator" aria-hidden="true" />
            </div>
          )}

          {!isRegister && passwordChanged && (
            <p role="status" className="auth-screen-toast auth-screen-toast-success">
              密码修改成功，请重新登录
            </p>
          )}

          <form
            data-testid={isRegister ? 'register-fields' : undefined}
            className={`auth-register-fields ${isRegister ? '' : 'auth-login-fields'}`}
            onSubmit={submit}
            noValidate
          >
            {isRegister && registerStep > 0 && (
              <button
                type="button"
                className="auth-register-back"
                onClick={returnToPreviousRegistrationStep}
                aria-label="返回上一步"
              >
                <ArrowLeft {...AUTH_ICON_PROPS} />
              </button>
            )}

            <div
              key={isRegister ? `register-${registerStep}` : `login-${mode}`}
              data-testid="auth-motion-stage"
              data-motion-direction={motionDirection}
              className={`auth-motion-stage auth-motion-stage-${motionDirection}`}
            >
              {(!isRegister || registerStep === 0) && (
                <AuthField
                  id={emailId}
                  label="邮箱"
                  icon={isRegister ? RegisterFieldIcon : EnvelopeSimple}
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onValueChange={setEmail}
                  inputRef={emailInputRef}
                  disabled={isSubmitting || isSendingCode}
                  placeholder="邮箱地址"
                />
              )}

              {((isRegister && registerStep === 1) || (!isRegister && mode === 'password')) && (
                <AuthField
                  id={passwordId}
                  label="密码"
                  icon={isRegister ? RegisterFieldIcon : Keyhole}
                  value={password}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  placeholder={isRegister ? '创建密码' : '密码'}
                  disabled={isSubmitting}
                  type={showPassword ? 'text' : 'password'}
                  variant="password"
                  onValueChange={setPassword}
                  action={
                    <PasswordVisibilityButton
                      visible={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    />
                  }
                />
              )}

              {isRegister && registerStep === 2 && (
                <AuthField
                  id={nicknameId}
                  label="昵称（选填）"
                  icon={RegisterFieldIcon}
                  autoComplete="nickname"
                  maxLength={51}
                  value={nickname}
                  onValueChange={setNickname}
                  disabled={isSubmitting}
                  placeholder="昵称（可以稍后填写）"
                />
              )}

              {((isRegister && registerStep === 3) || (!isRegister && mode === 'code')) && (
                <AuthField
                  id={codeId}
                  label="验证码"
                  icon={isRegister ? RegisterFieldIcon : SealCheck}
                  value={code}
                  placeholder={isRegister ? '6 位验证码' : '6 位数字'}
                  disabled={isSubmitting}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  variant="code"
                  onValueChange={setCode}
                  action={
                    <button
                      type="button"
                      onClick={() => void sendCode()}
                      disabled={isSendingCode || isSubmitting || cooldownSeconds > 0}
                      aria-label={isRegister ? '重新发送验证码' : undefined}
                      className="auth-screen-code-action disabled:cursor-not-allowed"
                    >
                      {isSendingCode ? (
                        '正在发送…'
                      ) : cooldownSeconds > 0 ? (
                        `${cooldownSeconds}s`
                      ) : isRegister ? (
                        <ArrowsClockwise {...AUTH_ICON_PROPS} />
                      ) : (
                        '发送验证码'
                      )}
                    </button>
                  }
                />
              )}

              {!isRegister && mode === 'code' && (
                <p className="auth-screen-helper text-xs leading-5">
                  {/* 未注册的邮箱将在验证后自动创建账号。 */}
                  内测期间仅支持已有账号登录。
                </p>
              )}
            </div>

            {isRegister ? <div className="auth-register-feedback">{feedback}</div> : feedback}

            <button
              type="submit"
              disabled={isSubmitting || isSendingCode}
              className="auth-screen-submit px-4 text-white disabled:cursor-not-allowed"
            >
              <span key={submitContent} className="auth-submit-label">
                {Array.from(submitContent).map((character, index) => (
                  <span
                    key={`${character}-${index}`}
                    className="auth-submit-character"
                    style={{ '--auth-character-index': index } as CSSProperties}
                  >
                    {character}
                  </span>
                ))}
              </span>
            </button>
          </form>

          {/*
          <p className="auth-screen-entry-switch mt-7 text-center text-sm">
            {isRegister ? '已有账号？' : '还没有账号？'}{' '}
            <button type="button" onClick={() => switchEntry(isRegister ? 'login' : 'register')}>
              {isRegister ? '登录' : '创建账号'}
            </button>
          </p>
          */}
          <p className="auth-screen-entry-switch mt-7 text-center text-sm">
            {isRegister ? '邀请码已由邀请链接带入，无需填写。' : '注册仅通过邀请链接开放。'}
          </p>
        </div>
      </div>
    </div>
  )
}
