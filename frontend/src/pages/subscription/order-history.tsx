import type { BillOrder } from '@/entities'
import type { useBillOrders } from '@/features/billing'
import { Pagination } from '@/shared/ui'
import { credits, moment, money, orderStatus, secondaryButton } from './presentation'

export function OrderHistory({
  resource,
  onSelect,
  onPageChange,
}: {
  resource: ReturnType<typeof useBillOrders>
  onSelect(order: BillOrder): void
  onPageChange(page: number): void
}) {
  return (
    <section className="mt-12 border-t border-app-line pt-7" aria-labelledby="orders-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="orders-title" className="text-lg font-semibold">
          订单记录
        </h2>
        <button
          type="button"
          disabled={resource.status === 'loading'}
          onClick={resource.reload}
          className="rounded-app-compact px-2 py-1 text-sm text-app-muted hover:text-app-ink disabled:opacity-50"
        >
          刷新记录
        </button>
      </div>
      {resource.error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-app-danger">
            {resource.error}
          </p>
          <button type="button" onClick={resource.reload} className={secondaryButton}>
            重新加载订单
          </button>
        </div>
      ) : !resource.data ? (
        <p role="status" className="py-6 text-sm text-app-muted">
          正在加载订单…
        </p>
      ) : resource.data.items.length === 0 ? (
        <p className="py-6 text-sm text-app-muted">还没有订单。</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-app-line">
            {resource.data.items.map((order) => (
              <li key={order.orderNo}>
                <button
                  type="button"
                  onClick={() => onSelect(order)}
                  className="flex w-full flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-app-compact px-2 py-4 text-left transition-colors hover:bg-app-surface-muted focus-visible:outline-2 focus-visible:outline-app-accent"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {order.name} · {credits(order.credits)} 积分
                    </span>
                    <span className="mt-1 block text-xs text-app-faint">
                      {moment(order.createdAt)}
                    </span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-5">
                    <span className="text-sm font-medium tabular-nums">
                      {money(order.amountFen)}
                    </span>
                    <span className="min-w-12 text-right text-xs text-app-muted">
                      {orderStatus[order.status] ?? '待确认'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Pagination
            page={resource.data.page}
            pageSize={resource.data.pageSize}
            total={resource.data.total}
            disabled={resource.status === 'loading'}
            onPageChange={onPageChange}
          />
        </>
      )}
    </section>
  )
}
