import { AppHeader } from '@/app/layout/app-header'

/** 公开宣传页导航只负责理解产品与进入产品，不暴露工作台内部导航。 */
export function MarketingHeader() {
  return <AppHeader variant="marketing" />
}
