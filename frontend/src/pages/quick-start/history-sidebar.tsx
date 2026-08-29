import { useEffect, useState } from 'react'
import { ClockCounterClockwise, Note, NotePencil, SidebarSimple, X } from '@phosphor-icons/react'
import { Link } from 'react-router'

import type { QuickStartEntryService, QuickStartHistoryItem } from './service'

export function QuickStartHistorySidebar({
  service,
  activeRunId,
}: {
  service: QuickStartEntryService
  activeRunId?: string
}) {
  const [items, setItems] = useState<readonly QuickStartHistoryItem[]>([])
  const [loading, setLoading] = useState(Boolean(service.listHistory))
  const [error, setError] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(Boolean(service.listHistory))
    setError(null)
    void (service.listHistory?.() ?? Promise.resolve([])).then(
      (nextItems) => {
        if (!active) return
        setItems(nextItems)
        setLoading(false)
      },
      () => {
        if (!active) return
        setItems([])
        setError('历史记录暂时无法加载')
        setLoading(false)
      },
    )
    return () => {
      active = false
    }
  }, [activeRunId, service])

  const closeMobile = () => setMobileOpen(false)

  return (
    <>
      <button
        type="button"
        aria-label="打开创作历史"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
        className="fixed top-[4.25rem] left-3 z-40 grid size-10 place-items-center rounded-xl border border-app-line bg-app-surface-raised text-app-muted shadow-app-card transition hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent lg:hidden"
      >
        <SidebarSimple aria-hidden="true" size={21} weight="bold" />
      </button>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="关闭创作历史"
          onClick={closeMobile}
          className="fixed inset-0 z-40 bg-app-ink/20 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}

      <aside
        data-open={mobileOpen ? 'true' : 'false'}
        className={`fixed top-14 bottom-0 left-0 z-50 flex w-72 flex-col border-r border-app-line bg-app-surface px-3 py-4 text-app-ink shadow-app-panel transition-transform duration-200 lg:z-30 lg:translate-x-0 lg:shadow-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-xl bg-app-accent-soft text-app-accent">
              <ClockCounterClockwise aria-hidden="true" size={18} weight="bold" />
            </span>
            <div>
              <p className="font-serif text-base font-semibold">创作历史</p>
              <p className="text-[11px] text-app-faint">继续上一次 Quick Start</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="关闭创作历史"
            onClick={closeMobile}
            className="grid size-9 place-items-center rounded-lg text-app-muted hover:bg-app-surface-muted lg:hidden"
          >
            <X aria-hidden="true" size={17} weight="bold" />
          </button>
        </div>

        <Link
          to="/quick-start"
          aria-current={activeRunId ? undefined : 'page'}
          onClick={closeMobile}
          className={`mb-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
            activeRunId
              ? 'text-app-ink-soft hover:bg-app-surface-muted'
              : 'bg-app-accent-soft text-app-accent'
          }`}
        >
          <NotePencil aria-hidden="true" size={19} weight="bold" />
          新建创作
        </Link>

        <nav aria-label="创作历史" className="min-h-0 flex-1 overflow-y-auto">
          <p className="px-3 pb-2 font-mono text-[10px] font-bold tracking-[0.14em] text-app-faint">
            RECENT
          </p>
          {loading ? (
            <p role="status" className="px-3 py-3 text-xs text-app-muted">
              正在读取历史记录…
            </p>
          ) : error ? (
            <p role="alert" className="px-3 py-3 text-xs leading-5 text-app-danger-muted">
              {error}
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-3 text-xs leading-5 text-app-muted">还没有历史创作</p>
          ) : (
            <ol className="grid gap-1">
              {items.map((item) => {
                const current = item.runId === activeRunId
                return (
                  <li key={item.runId}>
                    <Link
                      to={`/quick-start/${encodeURIComponent(item.runId)}`}
                      aria-current={current ? 'page' : undefined}
                      onClick={closeMobile}
                      title={item.title}
                      className={`group flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
                        current
                          ? 'bg-app-surface-strong font-semibold text-app-ink'
                          : 'text-app-ink-soft hover:bg-app-surface-muted'
                      }`}
                    >
                      <Note
                        aria-hidden="true"
                        data-icon="history-entry"
                        size={17}
                        weight={current ? 'fill' : 'regular'}
                        className={current ? 'text-app-accent' : 'text-app-faint'}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    </Link>
                  </li>
                )
              })}
            </ol>
          )}
        </nav>
      </aside>
    </>
  )
}
