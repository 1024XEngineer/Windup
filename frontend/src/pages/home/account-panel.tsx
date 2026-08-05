import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router'

import { resolveAuthMode, useAuthSession, type AuthSessionValue } from '@/features/auth-session'

type PanelMode = 'code-login' | 'password-login' | 'register' | 'settings'
type PendingAction = 'send-code' | 'authenticate' | 'change-password' | 'logout' | null

interface AccountPanelProps {
  onClose(): void
}

const fieldClassName =
  'mt-2 w-full rounded-xl border border-[#c7cbc3] bg-[#f7f6f0] px-3 py-2.5 text-sm text-[#191b18] outline-none transition focus:border-[#263f2d] focus:ring-2 focus:ring-[#263f2d]/15'
const primaryButtonClassName =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1d211d] px-4 text-sm font-semibold text-white transition hover:bg-[#2b322b] disabled:cursor-not-allowed disabled:opacity-50'
const quietButtonClassName =
  'rounded-lg px-3 py-2 text-sm font-semibold text-[#536052] transition hover:bg-[#e4e7e0] disabled:cursor-not-allowed disabled:opacity-50'

export function AccountPanel({ onClose }: AccountPanelProps) {
  const session = useAuthSession()
  const localAuth = resolveAuthMode() === 'local'
  const navigate = useNavigate()
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const [searchParams, setSearchParams] = useSearchParams()
  const [mode, setMode] = useState<PanelMode>(() => modeFromQuery(searchParams.get('account')))
  const [email, setEmail] = useState(localAuth ? 'local@windup.dev' : '')
  const [code, setCode] = useState(localAuth ? 'local' : '')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [pending, setPending] = useState<PendingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    getFocusableElements(dialog)[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusableElements = getFocusableElements(dialogRef.current)
      const first = focusableElements[0]
      const last = focusableElements.at(-1)
      if (!first || !last) return

      const activeElement = document.activeElement
      if (
        event.shiftKey &&
        (activeElement === first || !dialogRef.current?.contains(activeElement))
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (activeElement === last || !dialogRef.current?.contains(activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(
      () => setCountdown((seconds) => Math.max(0, seconds - 1)),
      1_000,
    )
    return () => window.clearTimeout(timer)
  }, [countdown])

  const updateMode = (nextMode: PanelMode) => {
    setMode(nextMode)
    setError(null)
    setNotice(null)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(
      'account',
      nextMode === 'register' ? 'register' : nextMode === 'settings' ? 'settings' : 'login',
    )
    setSearchParams(nextParams, { replace: true })
  }

  const sendCode = async () => {
    setPending('send-code')
    setError(null)
    try {
      await session.sendCode({
        email: email.trim(),
        purpose: mode === 'register' ? 'register' : 'login',
      })
      setCountdown(60)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending('authenticate')
    setError(null)
    try {
      if (mode === 'register') {
        const trimmedNickname = nickname.trim()
        await session.register({
          email: email.trim(),
          password,
          code: code.trim(),
          ...(trimmedNickname ? { nickname: trimmedNickname } : {}),
        })
      } else if (mode === 'password-login') {
        await session.login({ email: email.trim(), password, code: code.trim() })
      } else {
        await session.loginByCode({ email: email.trim(), code: code.trim() })
      }

      const returnTo = resolveSafeReturnTo(searchParams.get('returnTo'))
      navigate(returnTo ?? '/', { replace: true })
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending('change-password')
    setError(null)
    try {
      await session.changePassword({ oldPassword, newPassword })
      setOldPassword('')
      setNewPassword('')
      updateMode('code-login')
      setNotice('密码已修改，请重新登录')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  const logout = async () => {
    setPending('logout')
    setError(null)
    try {
      await session.logout()
      onClose()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  const authenticatedUser = session.state.status === 'authenticated' ? session.state.user : null
  const showSettings = mode === 'settings' && authenticatedUser !== null
  const isBusy = pending !== null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-[#10130f]/55 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="点击遮罩关闭账户面板"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={showSettings ? '个人设置' : '账户认证'}
        className="relative z-10 flex h-full w-full max-w-[31rem] flex-col overflow-y-auto border-l border-white/70 bg-[#eef0eb] shadow-[-24px_0_70px_rgba(13,16,13,0.2)] sm:w-[min(90vw,31rem)]"
      >
        <header className="flex items-start justify-between border-b border-[#d0d4cc] px-6 py-5 sm:px-8">
          <div>
            <p className="font-mono text-[9px] font-semibold tracking-[0.2em] text-[#858b83]">
              WINDUP ACCOUNT
            </p>
            <p className="mt-2 text-xs leading-5 text-[#697068]">
              {showSettings ? '账户资料与安全设置' : '继续你的角色制作流程'}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭账户面板"
            className="grid h-9 w-9 place-items-center rounded-full border border-[#c7cbc3] text-lg text-[#545b53] transition hover:bg-white"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="flex flex-1 flex-col px-6 py-7 sm:px-8 sm:py-9">
          {error ? (
            <p
              role="alert"
              className="mb-5 rounded-xl border border-[#b88476] bg-[#f5e6df] px-4 py-3 text-sm text-[#782d25]"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              role="status"
              className="mb-5 rounded-xl border border-[#91a18e] bg-[#e4ece1] px-4 py-3 text-sm text-[#263f2d]"
            >
              {notice}
            </p>
          ) : null}

          {showSettings && authenticatedUser ? (
            <SettingsPanel
              user={authenticatedUser}
              oldPassword={oldPassword}
              newPassword={newPassword}
              pending={pending}
              onOldPasswordChange={setOldPassword}
              onNewPasswordChange={setNewPassword}
              onChangePassword={changePassword}
              onLogout={logout}
            />
          ) : (
            <AuthPanel
              localAuth={localAuth}
              mode={mode === 'settings' ? 'code-login' : mode}
              email={email}
              code={code}
              password={password}
              nickname={nickname}
              countdown={countdown}
              pending={pending}
              isBusy={isBusy}
              onModeChange={updateMode}
              onEmailChange={setEmail}
              onCodeChange={setCode}
              onPasswordChange={setPassword}
              onNicknameChange={setNickname}
              onSendCode={sendCode}
              onSubmit={authenticate}
            />
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}

interface AuthPanelProps {
  localAuth: boolean
  mode: Exclude<PanelMode, 'settings'>
  email: string
  code: string
  password: string
  nickname: string
  countdown: number
  pending: PendingAction
  isBusy: boolean
  onModeChange(mode: PanelMode): void
  onEmailChange(value: string): void
  onCodeChange(value: string): void
  onPasswordChange(value: string): void
  onNicknameChange(value: string): void
  onSendCode(): void
  onSubmit(event: FormEvent<HTMLFormElement>): void
}

function AuthPanel(props: AuthPanelProps) {
  const emailInputRef = useRef<HTMLInputElement>(null)
  const isRegister = props.mode === 'register'
  const isPasswordLogin = props.mode === 'password-login'

  const sendCode = () => {
    if (!emailInputRef.current?.reportValidity()) return
    props.onSendCode()
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl font-medium tracking-[-0.04em]">
            {isRegister ? '注册 Windup' : '登录 Windup'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#697068]">
            {props.localAuth && !isRegister
              ? '当前使用本地开发账户，不会连接真实认证服务。'
              : isRegister
                ? '创建账户，保存并继续你的制作。'
                : '登录后返回刚才的工作位置。'}
          </p>
        </div>
      </div>

      {isRegister ? (
        <button
          type="button"
          className={`${quietButtonClassName} mt-5 self-start`}
          disabled={props.isBusy}
          onClick={() => props.onModeChange('code-login')}
        >
          返回登录
        </button>
      ) : props.localAuth ? (
        <p className="mt-6 rounded-xl border border-[#b8c4b6] bg-[#e4ece1] px-4 py-3 text-sm text-[#314330]">
          开发账号已经准备好，直接进入工作台即可。
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 rounded-xl bg-[#dfe3dc] p-1">
          <button
            type="button"
            aria-pressed={props.mode === 'code-login'}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${props.mode === 'code-login' ? 'bg-[#f8f7f2] text-[#1d211d] shadow-sm' : 'text-[#6c746b]'}`}
            disabled={props.isBusy}
            onClick={() => props.onModeChange('code-login')}
          >
            验证码登录
          </button>
          <button
            type="button"
            aria-pressed={isPasswordLogin}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${isPasswordLogin ? 'bg-[#f8f7f2] text-[#1d211d] shadow-sm' : 'text-[#6c746b]'}`}
            disabled={props.isBusy}
            onClick={() => props.onModeChange('password-login')}
          >
            密码登录
          </button>
        </div>
      )}

      <form className="mt-7 grid gap-5" onSubmit={props.onSubmit}>
        <label className="text-xs font-semibold text-[#4e574d]">
          邮箱
          <input
            ref={emailInputRef}
            type="email"
            autoComplete="email"
            required
            className={fieldClassName}
            value={props.email}
            onChange={(event) => props.onEmailChange(event.target.value)}
          />
        </label>

        {!props.localAuth ? (
          <label className="text-xs font-semibold text-[#4e574d]">
            验证码
            <span className="mt-2 flex gap-2">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                className={`${fieldClassName} mt-0 min-w-0 flex-1`}
                value={props.code}
                onChange={(event) => props.onCodeChange(event.target.value)}
              />
              <button
                type="button"
                className="min-w-32 rounded-xl border border-[#9ca69a] bg-[#e7eae4] px-3 text-xs font-semibold text-[#314330] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
                disabled={props.isBusy || props.countdown > 0 || props.email.trim() === ''}
                onClick={sendCode}
              >
                {props.pending === 'send-code'
                  ? '正在发送…'
                  : props.countdown > 0
                    ? `${props.countdown} 秒后可重发`
                    : '发送验证码'}
              </button>
            </span>
          </label>
        ) : null}

        {isPasswordLogin || isRegister ? (
          <label className="text-xs font-semibold text-[#4e574d]">
            密码
            <input
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              className={fieldClassName}
              value={props.password}
              onChange={(event) => props.onPasswordChange(event.target.value)}
            />
          </label>
        ) : null}

        {isRegister ? (
          <label className="text-xs font-semibold text-[#4e574d]">
            昵称（可选）
            <input
              autoComplete="nickname"
              className={fieldClassName}
              value={props.nickname}
              onChange={(event) => props.onNicknameChange(event.target.value)}
            />
          </label>
        ) : null}

        <button type="submit" className={primaryButtonClassName} disabled={props.isBusy}>
          {props.pending === 'authenticate'
            ? isRegister
              ? '正在注册…'
              : '正在登录…'
            : props.localAuth && !isRegister
              ? '进入本地工作台'
              : isRegister
                ? '创建账户'
                : isPasswordLogin
                  ? '使用密码登录'
                  : '使用验证码登录'}
        </button>
      </form>

      {!isRegister && !props.localAuth ? (
        <p className="mt-auto border-t border-[#d0d4cc] pt-7 text-center text-sm text-[#697068]">
          还没有账户？{' '}
          <button
            type="button"
            className="font-semibold text-[#263f2d] underline underline-offset-4 disabled:opacity-50"
            disabled={props.isBusy}
            onClick={() => props.onModeChange('register')}
          >
            注册账户
          </button>
        </p>
      ) : null}
    </>
  )
}

interface SettingsPanelProps {
  user: Extract<AuthSessionValue['state'], { status: 'authenticated' }>['user']
  oldPassword: string
  newPassword: string
  pending: PendingAction
  onOldPasswordChange(value: string): void
  onNewPasswordChange(value: string): void
  onChangePassword(event: FormEvent<HTMLFormElement>): void
  onLogout(): void
}

function SettingsPanel(props: SettingsPanelProps) {
  const disabled = props.pending !== null
  return (
    <>
      <h2 className="font-serif text-3xl font-medium tracking-[-0.04em]">个人设置</h2>
      <p className="mt-2 text-sm leading-6 text-[#697068]">查看账户资料并管理登录安全。</p>

      <dl className="mt-7 divide-y divide-[#d0d4cc] rounded-2xl border border-[#d0d4cc] bg-[#f8f7f2] px-4">
        <ProfileRow label="邮箱" value={props.user.email} />
        <ProfileRow label="昵称" value={props.user.nickname || '未设置'} />
        <ProfileRow label="邮箱验证" value={props.user.emailVerifiedAt ? '已验证' : '未验证'} />
        <ProfileRow label="账户状态" value={props.user.status === 'normal' ? '正常' : '已封禁'} />
      </dl>

      <form
        className="mt-8 grid gap-5 border-t border-[#d0d4cc] pt-7"
        onSubmit={props.onChangePassword}
      >
        <div>
          <h3 className="font-serif text-xl font-medium">修改密码</h3>
          <p className="mt-1 text-xs leading-5 text-[#747b73]">修改成功后需要重新登录。</p>
        </div>
        <label className="text-xs font-semibold text-[#4e574d]">
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            required
            className={fieldClassName}
            value={props.oldPassword}
            onChange={(event) => props.onOldPasswordChange(event.target.value)}
          />
        </label>
        <label className="text-xs font-semibold text-[#4e574d]">
          新密码
          <input
            type="password"
            autoComplete="new-password"
            required
            className={fieldClassName}
            value={props.newPassword}
            onChange={(event) => props.onNewPasswordChange(event.target.value)}
          />
        </label>
        <button type="submit" className={primaryButtonClassName} disabled={disabled}>
          {props.pending === 'change-password' ? '正在修改…' : '修改密码'}
        </button>
      </form>

      <button
        type="button"
        className="mt-8 min-h-11 rounded-xl border border-[#a9867d] px-4 text-sm font-semibold text-[#71382f] transition hover:bg-[#f5e6df] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={props.onLogout}
      >
        {props.pending === 'logout' ? '正在退出…' : '退出登录'}
      </button>
    </>
  )
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-4 py-4 text-sm">
      <dt className="text-[#7a8179]">{label}</dt>
      <dd className="break-all font-medium text-[#252a24]">{value}</dd>
    </div>
  )
}

function modeFromQuery(value: string | null): PanelMode {
  if (value === 'register') return 'register'
  if (value === 'settings') return 'settings'
  return 'code-login'
}

function resolveSafeReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null
  }

  try {
    const currentOrigin = globalThis.location.origin
    const resolved = new URL(value, currentOrigin)
    if (resolved.origin !== currentOrigin) return null
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return null
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败，请稍后重试'
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex >= 0)
}
