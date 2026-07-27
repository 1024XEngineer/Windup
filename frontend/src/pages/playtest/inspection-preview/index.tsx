import type { Character, WorkflowLocation } from '@/entities'

/**
 * 检查/预览台模块的全部公开接口。
 *
 * 模块内部负责动作切换、播放、按键绑定和当前帧；它不操作 Router，
 * 只把已解析的工作流位置交给页面跳转。
 */
export interface InspectionPreviewProps {
  characterId: Character['id']
  onOpenWorkflowAtFrame: (location: WorkflowLocation) => void
}

/**
 * 以一个角色为输入的独立检查/预览台。
 *
 * 本 Issue 只落模块边界；PixiJS、按键绑定与单帧退回链路属后续实现。
 * 逐帧审核的写入能力仍由 Review Feature / Entities 提供，本模块不复制一套。
 */
// onOpenWorkflowAtFrame 已在契约中定义，调用点随真实播放与逐帧退回一起补，
// 当前刻意不使用，避免造出一个没有触发路径的假实现。
export function InspectionPreview({ characterId }: InspectionPreviewProps) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-400">
      检查/预览台待实现（角色 {characterId}）：动作切换、按键绑定、播放与逐帧定格。
    </section>
  )
}
