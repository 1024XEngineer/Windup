import { PageContainer } from '@/shared/ui'

/** 快速开始。 */
export function QuickStartPage() {
  return (
    <PageContainer>
      <section className="border border-dashed border-slate-300 p-6">
        <h1 className="font-medium">快速开始</h1>
        <p className="mt-2 text-sm text-slate-500">本次只提交模块划分与接口，页面实现进后续 PR。</p>
      </section>
    </PageContainer>
  )
}
