export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  disabled?: boolean
  onPageChange: (page: number) => void
}

/** 后端分页列表共用的最小翻页控件，不解释具体业务项。 */
export function Pagination({
  page,
  pageSize,
  total,
  disabled = false,
  onPageChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages === 1) return null

  return (
    <nav aria-label="分页" className="mt-6 flex items-center justify-center gap-3 text-xs">
      <button
        type="button"
        aria-label="上一页"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="rounded-full border border-[#cbd1c8] px-3 py-1.5 font-semibold text-[#4d564e] disabled:cursor-not-allowed disabled:opacity-40"
      >
        上一页
      </button>
      <span className="tabular-nums text-[#747b73]">
        第 {page} / {totalPages} 页 · 共 {total} 项
      </span>
      <button
        type="button"
        aria-label="下一页"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="rounded-full border border-[#cbd1c8] px-3 py-1.5 font-semibold text-[#4d564e] disabled:cursor-not-allowed disabled:opacity-40"
      >
        下一页
      </button>
    </nav>
  )
}
