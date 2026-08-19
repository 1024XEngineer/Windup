import { CaretLeft, CaretRight } from '@phosphor-icons/react'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  disabled?: boolean
  showPageNumbers?: boolean
  onPageChange: (page: number) => void
}

function visiblePages(page: number, totalPages: number): number[] {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)
  return [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((left, right) => left - right)
}

/** 后端分页列表共用的最小翻页控件，不解释具体业务项。 */
export function Pagination({
  page,
  pageSize,
  total,
  disabled = false,
  showPageNumbers = false,
  onPageChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages === 1) return null

  if (showPageNumbers) {
    const pages = visiblePages(page, totalPages)
    return (
      <nav
        aria-label="分页"
        className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-xs"
      >
        <button
          type="button"
          aria-label="上一页"
          title="上一页"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="grid size-8 place-items-center rounded-md border border-app-line text-app-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CaretLeft aria-hidden="true" size={15} weight="bold" />
        </button>
        {pages.map((value, index) => {
          const previous = pages[index - 1]
          return (
            <span key={value} className="contents">
              {previous !== undefined && value - previous > 1 && (
                <span aria-hidden="true" className="px-1 text-app-faint">
                  …
                </span>
              )}
              <button
                type="button"
                aria-label={`第 ${value} 页`}
                aria-current={value === page ? 'page' : undefined}
                disabled={disabled}
                onClick={() => onPageChange(value)}
                className={`size-8 rounded-md border text-center font-semibold tabular-nums disabled:cursor-not-allowed disabled:opacity-40 ${
                  value === page
                    ? 'border-app-accent bg-app-accent text-app-on-accent'
                    : 'border-app-line text-app-ink-soft hover:border-app-line-strong'
                }`}
              >
                {value}
              </button>
            </span>
          )
        })}
        <button
          type="button"
          aria-label="下一页"
          title="下一页"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="grid size-8 place-items-center rounded-md border border-app-line text-app-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CaretRight aria-hidden="true" size={15} weight="bold" />
        </button>
        <span className="ml-2 tabular-nums text-app-faint">共 {total} 条</span>
      </nav>
    )
  }

  return (
    <nav aria-label="分页" className="mt-6 flex items-center justify-center gap-3 text-xs">
      <button
        type="button"
        aria-label="上一页"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="rounded-full border border-app-line px-3 py-1.5 font-semibold text-app-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        上一页
      </button>
      <span className="tabular-nums text-app-faint">
        第 {page} / {totalPages} 页 · 共 {total} 项
      </span>
      <button
        type="button"
        aria-label="下一页"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="rounded-full border border-app-line px-3 py-1.5 font-semibold text-app-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        下一页
      </button>
    </nav>
  )
}
