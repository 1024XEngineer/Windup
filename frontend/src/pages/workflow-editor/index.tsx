import { PageContainer } from '@/shared/ui'

/** 工作流画布。 */
export function WorkflowEditorPage() {
  return (
    <PageContainer>
      <section className="border border-dashed border-slate-300 p-6">
        <h1 className="font-medium">工作流画布</h1>
        <p className="mt-2 text-sm text-slate-500">本次只提交模块划分与接口，页面实现进后续 PR。</p>
      </section>
    </PageContainer>
  )
}
