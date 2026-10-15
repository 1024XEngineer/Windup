export function money(amountFen: number): string {
  return `¥${(amountFen / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

export function credits(value: number): string {
  return value.toLocaleString('zh-CN')
}

export function moment(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date)
    : '时间未知'
}

export const orderStatus: Record<number, string> = {
  0: '待支付',
  1: '已支付',
  2: '已关闭',
  3: '退款中',
  4: '已退款',
}
import { productControlClass } from '@/shared/ui'

export const primaryButton = productControlClass(
  'primary',
  'justify-center disabled:cursor-not-allowed disabled:opacity-50',
)
export const secondaryButton = productControlClass(
  'secondary',
  'justify-center disabled:cursor-not-allowed disabled:opacity-50',
)
