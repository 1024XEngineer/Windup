import { Link } from 'react-router'

/** 新建项目的路由骨架；表单与 ProjectApis 的实际绑定留待接口稳定后实现。 */
export function ProjectCreatePage() {
  return (
    <section className="border border-dashed border-slate-300 p-6">
      <h1 className="font-medium">新建项目</h1>
      <p className="mt-2 text-sm text-slate-500">
        项目创建表单将统一通过 ProjectApis 提交；当前可先查看既有项目的完成版本。
      </p>
      <Link
        className="mt-4 inline-block text-sm font-medium text-emerald-800 underline"
        to="/projects"
      >
        查看项目历史
      </Link>
    </section>
  )
}
