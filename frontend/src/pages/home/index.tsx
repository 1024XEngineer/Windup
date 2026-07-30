/** 首页：入口与项目概览。 */
export function HomePage() {
  return <PagePlaceholder title="首页" />
}

function PagePlaceholder({ title }: { title: string }) {
  return (
    <section className="border border-dashed border-slate-300 p-6">
      <h1 className="font-medium">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">本次只提交模块划分与接口，页面实现进后续 PR。</p>
    </section>
  )
}
