import { useEffect, useState } from 'react'
import { ListDashes, Note, NotePencil, X } from '@phosphor-icons/react'
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

  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMobile()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  return (
    <>
      <button
        type="button"
        aria-label="打开创作历史"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
        className="fixed top-[4.35rem] left-4 z-40 grid size-9 place-items-center p-1 text-app-ink-soft transition-colors duration-150 hover:text-app-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ink"
      >
        <ListDashes aria-hidden="true" size={23} weight="regular" />
      </button>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="关闭创作历史"
          onClick={closeMobile}
          className="fixed inset-0 z-40 bg-transparent"
        />
      ) : null}

      <aside
        data-open={mobileOpen ? 'true' : 'false'}
        className={`fixed top-[7.25rem] left-4 z-50 flex max-h-[calc(100vh-8.25rem)] w-[min(18rem,calc(100vw-2rem))] flex-col rounded-app-surface border border-app-line bg-app-surface px-3 py-4 text-app-ink shadow-app-menu transition duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
          mobileOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
        }`}
      >
        <div className="mb-3 flex items-center justify-between px-2">
          <p className="font-serif text-base font-semibold">创作历史</p>
          <button
            type="button"
            aria-label="关闭创作历史"
            onClick={closeMobile}
            className="grid size-9 place-items-center rounded-app-compact text-app-muted transition-colors hover:bg-app-surface-muted hover:text-app-ink"
          >
            <X aria-hidden="true" size={17} weight="bold" />
          </button>
        </div>

        <Link
          to="/quick-start"
          aria-current={activeRunId ? undefined : 'page'}
          onClick={closeMobile}
          className={`mb-4 flex items-center gap-3 rounded-app-control px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
            activeRunId
              ? 'text-app-ink-soft hover:bg-app-surface-muted'
              : 'text-app-ink-soft hover:bg-app-surface-muted'
          }`}
        >
          <NotePencil aria-hidden="true" size={19} weight="bold" />
          新建创作
        </Link>

        <nav aria-label="创作历史" className="min-h-0 flex-1 overflow-y-auto">
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
                      className={`group flex min-w-0 items-center gap-2.5 rounded-app-control px-3 py-2.5 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
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
