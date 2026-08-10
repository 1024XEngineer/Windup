import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import type { User } from '@/entities'
import { useAuthSession } from '@/features/auth-session'
import { PageContainer } from '@/shared/ui'

const fieldClass =
  'min-h-11 w-full rounded-xl border border-[#98a39b] bg-white px-3.5 text-base text-[#1c231e] outline-none transition-[border-color,box-shadow] placeholder:text-[#8a948c] focus:border-[#284331] focus:ring-2 focus:ring-[#284331]/18 disabled:cursor-not-allowed disabled:bg-[#f1f3f1]'
const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-[#284331] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(40,67,49,0.14)] transition-[background-color,transform] hover:bg-[#1f3627] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#284331] disabled:cursor-not-allowed disabled:bg-[#77857b] disabled:shadow-none'

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
    if (normalizedNickname.length > 50) {
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

  if (!currentUser) return null

  return (
    <PageContainer>
      <section className="mx-auto max-w-5xl text-[#1c231e]">
        <header className="border-b border-[#284331]/14 pb-7">
          <p className="text-[11px] font-bold tracking-[0.16em] text-[#617064] uppercase">
            Windup account
          </p>
          <h1 className="mt-2 font-serif text-3xl leading-tight font-semibold sm:text-4xl">
            账号中心
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#68736a]">
            查看账号资料，更新 Windup 中显示的称呼，或管理登录密码。
          </p>
        </header>

        <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
          <section className="overflow-hidden rounded-2xl border border-[#284331]/16 bg-[#f8faf8] shadow-[0_14px_38px_rgba(24,40,29,0.07)]">
            <div className="grid gap-5 border-b border-[#284331]/12 bg-[#e9efea] px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
              <div>
                <p className="text-xs font-semibold text-[#617064]">当前账号</p>
                <p className="mt-1 break-all font-mono text-sm font-semibold text-[#284331]">
                  {currentUser.email}
                </p>
              </div>
              <div className="justify-self-start rounded-full border border-[#56725d]/25 bg-[#f5faf6] px-3 py-1.5 text-xs font-semibold text-[#3d6047] sm:justify-self-end">
                {currentUser.emailVerifiedAt ? '邮箱已验证' : '邮箱未验证'}
              </div>
            </div>

            <div className="grid gap-6 px-5 py-6 sm:px-6">
              <dl className="grid gap-2 rounded-xl border border-[#284331]/10 bg-white/70 p-4 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
                <dt className="font-semibold text-[#617064]">邮箱验证时间</dt>
                <dd className="text-[#344039]">
                  {currentUser.emailVerifiedAt ? (
                    <time dateTime={currentUser.emailVerifiedAt}>
                      {formatVerificationTime(currentUser.emailVerifiedAt)}
                    </time>
                  ) : (
                    '尚未验证'
                  )}
                </dd>
              </dl>

              <form className="grid gap-4" onSubmit={saveNickname} noValidate>
                <div className="grid gap-1.5">
                  <label htmlFor={nicknameId} className="text-sm font-semibold text-[#344039]">
                    昵称
                  </label>
                  <input
                    id={nicknameId}
                    type="text"
                    autoComplete="nickname"
                    value={nickname}
                    maxLength={51}
                    disabled={isProfileLoading || isSavingNickname}
                    onChange={(event) => setNickname(event.target.value)}
                    className={fieldClass}
                    aria-describedby={`${nicknameId}-hint`}
                  />
                  <span id={`${nicknameId}-hint`} className="text-xs text-[#778078]">
                    1–50 个字符；保存后会同步显示在页面顶栏。
                  </span>
                </div>

                {profileError && (
                  <p
                    role="alert"
                    className="rounded-xl bg-[#fff5f3] px-3.5 py-3 text-sm text-[#8a3932]"
                  >
                    {profileError}
                  </p>
                )}
                {profileSuccess && (
                  <p
                    role="status"
                    className="rounded-xl bg-[#eef5ef] px-3.5 py-3 text-sm text-[#34533c]"
                  >
                    {profileSuccess}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-[#778078]">
                    {isProfileLoading
                      ? '正在同步最新资料…'
                      : isProfileFresh
                        ? '资料已同步'
                        : '资料同步失败'}
                  </span>
                  <button
                    type="submit"
                    disabled={isProfileLoading || isSavingNickname}
                    className={primaryButtonClass}
                  >
                    {isSavingNickname ? '正在保存…' : '保存昵称'}
                  </button>
                </div>
              </form>
            </div>
          </section>

          <div className="grid gap-6">
            <section className="rounded-2xl border border-[#284331]/16 bg-[#f8faf8] p-5 shadow-[0_14px_38px_rgba(24,40,29,0.07)] sm:p-6">
              <h2 className="font-serif text-xl font-semibold">登录安全</h2>
              <p className="mt-2 text-sm leading-6 text-[#68736a]">
                修改后当前会话会立即退出，需要使用新密码重新登录。
              </p>

              <form className="mt-5 grid gap-4" onSubmit={changePassword} noValidate>
                <label
                  htmlFor={oldPasswordId}
                  className="grid gap-1.5 text-sm font-semibold text-[#344039]"
                >
                  当前密码
                  <input
                    id={oldPasswordId}
                    type="password"
                    autoComplete="current-password"
                    value={oldPassword}
                    disabled={isChangingPassword}
                    onChange={(event) => setOldPassword(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <div className="grid gap-1.5 text-sm font-semibold text-[#344039]">
                  <label htmlFor={newPasswordId}>新密码</label>
                  <input
                    id={newPasswordId}
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    disabled={isChangingPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className={fieldClass}
                    aria-describedby={`${newPasswordId}-hint`}
                  />
                  <span id={`${newPasswordId}-hint`} className="text-xs font-normal text-[#778078]">
                    8–128 位
                  </span>
                </div>

                {passwordError && (
                  <p
                    role="alert"
                    className="rounded-xl bg-[#fff5f3] px-3.5 py-3 text-sm text-[#8a3932]"
                  >
                    {passwordError}
                  </p>
                )}

                <button type="submit" disabled={isChangingPassword} className={primaryButtonClass}>
                  {isChangingPassword ? '正在修改…' : '修改密码'}
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-[#8a5a4d]/20 bg-[#fff9f6] p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-[#613e35]">退出登录</h2>
              <p className="mt-2 text-sm leading-6 text-[#7a5b53]">
                退出只影响当前浏览器中的 Windup 会话。
              </p>
              <button
                type="button"
                onClick={signOut}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-[#8a5a4d]/35 px-4 text-sm font-semibold text-[#7b4035] transition-colors hover:bg-[#f5e8e3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7b4035]"
              >
                退出当前账号
              </button>
            </section>
          </div>
        </div>
      </section>
    </PageContainer>
  )
}
