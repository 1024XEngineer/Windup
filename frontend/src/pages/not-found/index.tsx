import { useNavigate } from 'react-router'

import { PageHeader } from '@/shared/ui'

/** 路由兜底：地址不存在时不留白屏，给一条回去的路。 */
export function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <>
      <PageHeader title="页面不存在" subtitle="地址可能拼错了，或者这个页面还没做" />
      <button
        type="button"
        onClick={() => navigate('/')}
        className="rounded-lg border border-slate-200 px-4 py-2 text-sm hover:border-slate-400"
      >
        回到快速开始
      </button>
    </>
  )
}
