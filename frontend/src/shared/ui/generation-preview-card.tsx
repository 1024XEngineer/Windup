import { PixelMatrix } from './pixel-matrix'
import './generation-preview-card.css'

export interface GenerationPreviewCardProps {
  label: string
  radius?: 'output' | 'node'
  size?: 'candidate' | 'master'
}

/**
 * 异步生成任务的稳定视觉占位。页面仍拥有文案和任务状态，组件只统一预览尺寸、点阵和动效。
 */
export function GenerationPreviewCard({
  label,
  radius = 'output',
  size = 'candidate',
}: GenerationPreviewCardProps) {
  return (
    <div className="generation-preview-shell">
      <div
        role="img"
        aria-label={label}
        data-generation-preview="true"
        data-generation-preview-size={size}
        data-generation-preview-radius={radius}
        data-generation-preview-fit="container"
        data-generation-state="generating"
        data-generation-motion="continuous"
        data-reveal="generation-canvas"
        className={`generation-preview-card generation-preview-card--${radius} generation-preview-card--${size}`}
      >
        <PixelMatrix />
      </div>
    </div>
  )
}
