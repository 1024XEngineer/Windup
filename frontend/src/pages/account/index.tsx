import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import accountBadgeArtwork from '@/assets/account/illustrations/account-badge.webp'
import type { User } from '@/entities'
import { useAuthSession } from '@/features/auth-session'

import './account.css'

const MAX_NICKNAME_LENGTH = 50

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

function formatVerificationTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '验证时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** 账号页以 /auth/me 为事实来源；会话层负责把刷新和编辑结果同步给 Header。 */
export function AccountPage() {
  const session = useAuthSession()
  const {
    changePassword: changeSessionPassword,
    logout,
    refreshCurrentUser,
    updateNickname,
  } = session
  const currentUser = session.state.status === 'authenticated' ? session.state.user : null
  const profileRequestRef = useRef<Promise<User> | null>(null)
  const [nickname, setNickname] = useState(currentUser?.nickname ?? '')
  const [isProfileLoading, setIsProfileLoading] = useState(true)
  const [isProfileFresh, setIsProfileFresh] = useState(false)
  const [isSavingNickname, setIsSavingNickname] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'profile' | 'security'>('profile')
  const nicknameId = useId()
  const oldPasswordId = useId()
  const newPasswordId = useId()

  useEffect(() => {
    let active = true
    profileRequestRef.current ??= refreshCurrentUser()
    void profileRequestRef.current.then(
      (user) => {
        if (!active) return
        setNickname(user.nickname ?? '')
        setIsProfileFresh(true)
        setProfileError(null)
        setIsProfileLoading(false)
      },
      (error) => {
        if (!active) return
        setIsProfileFresh(false)
        setProfileError(errorMessage(error))
        setIsProfileLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [refreshCurrentUser])

  async function saveNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSavingNickname) return
    const normalizedNickname = nickname.trim()
    if (!normalizedNickname) {
      setProfileSuccess(null)
      setProfileError('昵称不能为空')
      return
    }
    if (normalizedNickname.length > MAX_NICKNAME_LENGTH) {
      setProfileSuccess(null)
      setProfileError('昵称不能超过 50 个字符')
      return
    }

    setProfileError(null)
    setProfileSuccess(null)
    setIsSavingNickname(true)
    try {
      const user = await updateNickname(normalizedNickname)
      setNickname(user.nickname ?? '')
      setIsProfileFresh(true)
      setProfileSuccess('昵称已更新。')
    } catch (error) {
      setProfileError(errorMessage(error))
    } finally {
      setIsSavingNickname(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isChangingPassword) return
    if (!oldPassword) {
      setPasswordError('请输入当前密码')
      return
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setPasswordError('新密码需为 8–128 位')
      return
    }

    setPasswordError(null)
    setIsChangingPassword(true)
    try {
      await changeSessionPassword({ oldPassword, newPassword })
    } catch (error) {
      setPasswordError(errorMessage(error))
      setIsChangingPassword(false)
    }
  }

  function signOut() {
    void logout().catch(() => undefined)
  }

  function selectSection(section: 'profile' | 'security') {
    setActiveSection(section)
    setProfileError(null)
    setProfileSuccess(null)
    setPasswordError(null)
    setOldPassword('')
    setNewPassword('')
  }

  if (!currentUser) return null

  const displayName = currentUser.nickname || currentUser.email.split('@')[0]
  const initial = Array.from(displayName)[0]?.toUpperCase() ?? 'W'

  return (
    <div data-account-page className="min-h-[100dvh] bg-app-canvas text-app-ink">
      <div
        data-account-shell
        className="mx-auto w-full max-w-[1560px] px-4 pt-[clamp(4.75rem,11vh,7rem)] pb-10 sm:px-6 xl:px-8"
      >
        <header className="min-h-[clamp(9rem,16vw,12rem)]">
          <div>
            <p className="font-mono text-[0.65rem] tracking-[0.12em] text-app-faint uppercase">
              Account
            </p>
            <div className="mt-2 flex items-center gap-[clamp(0.5rem,1.5vw,1.25rem)]">
              <h1 className="font-serif text-[clamp(2.15rem,4.5vw,4rem)] leading-none font-medium tracking-[-0.055em] text-app-ink">
                账号中心
              </h1>
              <button
                type="button"
                aria-label="摇一摇工牌"
                onClick={(event) => {
                  event.currentTarget.classList.remove('account-badge-shake')
                  // Force a reflow so rapid clicks can restart the one-shot CSS animation.
                  void event.currentTarget.offsetWidth
                  event.currentTarget.classList.add('account-badge-shake')
                }}
                className="account-badge-button h-[clamp(11rem,19vw,14rem)] w-[clamp(7.5rem,13vw,10rem)] shrink-0 cursor-pointer border-0 bg-transparent p-0 focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              >
                <img
                  data-testid="account-pixel-mark"
                  src={accountBadgeArtwork}
                  alt=""
                  aria-hidden="true"
                  draggable="false"
                  className="h-full w-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              </button>
            </div>
          </div>
        </header>

        <div
          data-account-layout="settings"
          className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-[clamp(2rem,4vw,4.5rem)]"
        >
          <aside className="flex flex-col">
            <nav aria-label="账号设置" className="grid gap-1 border-t border-app-line pt-4">
              {(
                [
                  ['profile', '个人资料'],
                  ['security', '登录安全'],
                ] as const
              ).map(([section, label]) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => selectSection(section)}
                  aria-current={activeSection === section ? 'page' : undefined}
                  className={`min-h-10 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
                    activeSection === section
                      ? 'bg-app-accent-soft font-semibold text-app-accent'
                      : 'text-app-muted hover:bg-app-accent-muted hover:text-app-ink-soft'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <button
              type="button"
              onClick={signOut}
              className="mt-5 min-h-10 rounded-lg px-3 text-left text-sm text-app-danger transition-colors hover:bg-app-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger"
            >
              退出当前账号
            </button>
          </aside>

          <section className="min-w-0 rounded-[1.1rem] border border-app-line bg-app-surface-raised p-6 sm:p-7">
            {activeSection === 'profile' ? (
              <div>
                <header>
                  <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">
                    个人资料
                  </h2>
                  <p className="mt-1.5 text-sm text-app-muted">管理你的公开身份和账号邮箱。</p>
                </header>

                <div className="mt-5 flex items-center gap-4 border-b border-app-line pb-5">
                  <span className="grid size-14 shrink-0 place-items-center rounded-full bg-app-accent-soft font-serif text-2xl text-app-accent">
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-app-ink-soft">
                      {displayName}
                    </p>
                    <p className="mt-1 truncate text-sm text-app-muted">{currentUser.email}</p>
                  </div>
                  <span className="ml-auto rounded-full bg-app-accent-soft px-2.5 py-1 text-xs font-medium text-app-accent">
                    {currentUser.emailVerifiedAt ? '已验证' : '未验证'}
                  </span>
                </div>

                <form className="mt-5 grid gap-4" onSubmit={saveNickname} noValidate>
                  <div className="grid max-w-xl gap-1.5">
                    <label htmlFor={nicknameId} className="text-sm font-medium text-app-ink-soft">
                      昵称
                    </label>
                    <input
                      id={nicknameId}
                      type="text"
                      autoComplete="nickname"
                      value={nickname}
                      maxLength={MAX_NICKNAME_LENGTH + 1}
                      disabled={isProfileLoading || isSavingNickname}
                      onChange={(event) => setNickname(event.target.value)}
                      className="account-field"
                      aria-describedby={`${nicknameId}-hint`}
                    />
                    <span id={`${nicknameId}-hint`} className="text-xs leading-5 text-app-faint">
                      1–{MAX_NICKNAME_LENGTH} 个字符，保存后同步显示在页面顶栏。
                    </span>
                  </div>

                  <dl className="grid max-w-xl gap-1 rounded-lg bg-app-surface-muted px-4 py-3 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
                    <dt className="text-app-muted">邮箱验证时间</dt>
                    <dd className="text-app-ink-soft">
                      {currentUser.emailVerifiedAt ? (
                        <time dateTime={currentUser.emailVerifiedAt}>
                          {formatVerificationTime(currentUser.emailVerifiedAt)}
                        </time>
                      ) : (
                        '尚未验证'
                      )}
                    </dd>
                  </dl>

                  {profileError && (
                    <p
                      role="alert"
                      className="max-w-xl rounded-lg bg-app-danger-soft px-3 py-2.5 text-sm text-app-danger"
                    >
                      {profileError}
                    </p>
                  )}
                  {profileSuccess && (
                    <p
                      role="status"
                      className="max-w-xl rounded-lg bg-app-accent-muted px-3 py-2.5 text-sm text-app-accent"
                    >
                      {profileSuccess}
                    </p>
                  )}

                  <div className="flex max-w-xl flex-wrap items-center justify-between gap-4">
                    <span className="text-xs text-app-faint">
                      {isProfileLoading
                        ? '正在同步最新资料…'
                        : isProfileFresh
                          ? '资料已同步'
                          : '资料同步失败'}
                    </span>
                    <button
                      type="submit"
                      disabled={isProfileLoading || isSavingNickname}
                      className="account-primary-button"
                    >
                      {isSavingNickname ? '正在保存…' : '保存昵称'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div>
                <header>
                  <h2 className="text-xl font-semibold tracking-[-0.025em] text-app-ink-soft">
                    登录安全
                  </h2>
                  <p className="mt-1.5 text-sm leading-6 text-app-muted">
                    修改密码后，当前会话会退出。
                  </p>
                </header>

                <form className="mt-5 grid max-w-xl gap-4" onSubmit={changePassword} noValidate>
                  <label
                    htmlFor={oldPasswordId}
                    className="grid gap-1.5 text-sm font-medium text-app-ink-soft"
                  >
                    当前密码
                    <input
                      id={oldPasswordId}
                      type="password"
                      autoComplete="current-password"
                      value={oldPassword}
                      disabled={isChangingPassword}
                      onChange={(event) => setOldPassword(event.target.value)}
                      className="account-field"
                    />
                  </label>
                  <div className="grid gap-1.5 text-sm font-medium text-app-ink-soft">
                    <label htmlFor={newPasswordId}>新密码</label>
                    <input
                      id={newPasswordId}
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      disabled={isChangingPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      className="account-field"
                      aria-describedby={`${newPasswordId}-hint`}
                    />
                    <span
                      id={`${newPasswordId}-hint`}
                      className="text-xs font-normal text-app-faint"
                    >
                      8–128 位
                    </span>
                  </div>
                  {passwordError && (
                    <p
                      role="alert"
                      className="rounded-lg bg-app-danger-soft px-3 py-2.5 text-sm text-app-danger"
                    >
                      {passwordError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={isChangingPassword}
                    className="account-primary-button justify-self-start"
                  >
                    {isChangingPassword ? '正在修改…' : '修改密码'}
                  </button>
                </form>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
