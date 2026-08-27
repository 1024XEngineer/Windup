import { useState, type FormEvent } from 'react'
import {
  ArrowRight,
  CheckCircle,
  CirclesFour,
  Database,
  Key,
  LockKey,
  SignOut,
  SlidersHorizontal,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react'

import { AdminApiError } from './api'
import { useAdminSession } from './session'

const pendingModules = [
  { label: '网关与模型', description: 'Provider、凭据、图文与视频模型', icon: Database },
  { label: '路由与熔断', description: '路由策略、降级链与 URL 切换', icon: SlidersHorizontal },
  { label: '敏感词', description: '沿用现有词库与匹配服务', icon: WarningCircle },
  { label: '兑换码', description: '迁移现有积分兑换能力', icon: Key },
  { label: '用户与积分', description: '用户状态、账户与积分流水', icon: UsersThree },
] as const

function LoginPage() {
  const { state, login } = useAdminSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(state.status === 'guest' ? state.error : null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : '登录失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-story" aria-label="管理平台说明">
        <div className="admin-wordmark">
          <img src="/windup-mark.svg" alt="" />
          <span>Windup</span>
          <small>CONTROL ROOM</small>
        </div>
        <div className="admin-login-copy">
          <p className="admin-kicker">独立管理域 · admin.windup.xin</p>
          <h1>
            把运行规则，
            <br />
            收进一处。
          </h1>
          <p>
            这里承接 Windup 已有的配置与运营能力。管理员身份与普通用户彻底隔离，
            每次变更都进入审计链。
          </p>
        </div>
        <div className="admin-security-note">
          <LockKey aria-hidden="true" weight="duotone" />
          <span>独立账号 · Cookie 会话 · 权限校验 · 操作审计</span>
        </div>
      </section>

      <section className="admin-login-panel" aria-label="管理员登录">
        <form onSubmit={submit}>
          <header>
            <p>ADMIN ACCESS</p>
            <h2>管理员登录</h2>
            <span>仅接受通过服务器初始化的独立管理员账号。</span>
          </header>

          <label>
            <span>管理员邮箱</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span>管理员密码</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={12}
              required
            />
          </label>

          {error ? (
            <p className="admin-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={submitting}>
            <span>{submitting ? '正在验证…' : '进入管理台'}</span>
            <ArrowRight aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  )
}

function Dashboard() {
  const { state, logout } = useAdminSession()
  const [loggingOut, setLoggingOut] = useState(false)
  if (state.status !== 'authenticated') return null
  const { admin } = state

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="admin-console-shell">
      <aside className="admin-sidebar">
        <div className="admin-wordmark admin-wordmark-light">
          <img src="/windup-mark.svg" alt="" />
          <span>Windup</span>
          <small>ADMIN</small>
        </div>
        <nav aria-label="管理平台导航">
          <a href="#overview" aria-current="page">
            <CirclesFour aria-hidden="true" weight="fill" />
            运行总览
          </a>
          {pendingModules.map(({ label, icon: Icon }) => (
            <button type="button" disabled key={label} title={`${label}尚未迁移`}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              <small>待迁移</small>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-account">
          <span>{admin.email}</span>
          <small>{admin.permissions.length} 项权限</small>
          <button type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
            <SignOut aria-hidden="true" />
            {loggingOut ? '退出中…' : '安全退出'}
          </button>
        </div>
      </aside>

      <main className="admin-console-main" id="overview">
        <header className="admin-console-header">
          <div>
            <p>FOUNDATION / 01</p>
            <h1>运行总览</h1>
            <span>管理平台基础已就绪，现有能力将按模块逐项迁入。</span>
          </div>
          <div className="admin-live-indicator">
            <i />
            认证边界已启用
          </div>
        </header>

        <section className="admin-foundation-grid" aria-label="基础能力状态">
          {[
            ['独立管理员身份', '已接入', '普通用户 Token 无法访问管理 API'],
            ['RBAC 权限模型', '已接入', `${admin.permissions.length} 项权限已授予当前账号`],
            ['Cookie 会话安全', '已接入', 'HttpOnly、SameSite=Strict 与 CSRF 双重约束'],
            ['操作审计基座', '已接入', '登录与退出已写入独立审计表'],
          ].map(([title, status, detail], index) => (
            <article key={title} style={{ '--admin-card-order': index } as React.CSSProperties}>
              <CheckCircle aria-hidden="true" weight="fill" />
              <p>{status}</p>
              <h2>{title}</h2>
              <span>{detail}</span>
            </article>
          ))}
        </section>

        <section className="admin-migration-board" aria-labelledby="migration-heading">
          <header>
            <div>
              <p>MIGRATION QUEUE</p>
              <h2 id="migration-heading">现有能力迁移队列</h2>
            </div>
            <span>不重写 · 不造假 · 逐项切换</span>
          </header>
          <div>
            {pendingModules.map(({ label, description, icon: Icon }, index) => (
              <article key={label}>
                <span className="admin-migration-index">{String(index + 1).padStart(2, '0')}</span>
                <Icon aria-hidden="true" weight="duotone" />
                <div>
                  <h3>{label}</h3>
                  <p>{description}</p>
                </div>
                <small>待迁移</small>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export function AdminAppRoutes() {
  const { state } = useAdminSession()
  if (state.status === 'booting') {
    return (
      <main className="admin-boot">
        <span>W</span>
        <p>正在确认管理员会话…</p>
      </main>
    )
  }
  return state.status === 'authenticated' ? <Dashboard /> : <LoginPage />
}
