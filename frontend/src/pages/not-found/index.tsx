/** 页面不存在。 */
export function NotFoundPage() {
  return (
    <section className="border border-dashed border-slate-300 p-6">
      <h1 className="font-medium">页面不存在</h1>
      <p className="mt-2 text-sm text-slate-500">本次只提交模块划分与接口，页面实现进后续 PR。</p>
    </section>
  )
}
