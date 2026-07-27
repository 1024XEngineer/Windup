import { Link } from 'react-router'

import { PageHeader } from '@/shared/ui'

/** 根入口只负责提供两种制作入口，不持有工作流业务状态。 */
export function HomePage() {
  return (
    <>
      <PageHeader title="开始制作" subtitle="选择一种工作方式" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/quick-start"
          className="rounded-lg border border-slate-200 p-5 hover:border-slate-400"
        >
          <span className="block font-medium">快速开始</span>
          <span className="mt-1 block text-sm text-slate-500">用一句话描述你想制作的角色。</span>
        </Link>
        <Link
          to="/projects"
          className="rounded-lg border border-slate-200 p-5 hover:border-slate-400"
        >
          <span className="block font-medium">从项目开始</span>
          <span className="mt-1 block text-sm text-slate-500">从已有项目进入工作流。</span>
        </Link>
      </div>
    </>
  )
}
