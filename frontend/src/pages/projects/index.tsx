/** 项目历史入口；项目和已完成版本的具体列表在项目接口接入后实现。 */
export function ProjectsPage() {
  return (
    <section className="border border-dashed border-slate-300 p-6">
      <h1 className="font-medium">项目历史</h1>
      <p className="mt-2 text-sm text-slate-500">
        按项目查看已完成版本与其导出记录；具体列表等待 ProjectApis 接入。
      </p>
    </section>
  )
}
