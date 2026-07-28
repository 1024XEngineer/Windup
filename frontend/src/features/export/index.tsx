/**
 * 选择内容、发起导出和下载。下载属于本 feature，不放 shared/hooks。
 */
export interface ExportProps {
  characterId: string
  onExported?: (downloadUrl: string) => void
}

export function Export({ characterId }: ExportProps) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-400">
      导出待实现（角色 {characterId}）。
    </section>
  )
}
