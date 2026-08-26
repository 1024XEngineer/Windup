import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { Link } from 'react-router'

export interface AssetPreviewCardProps {
  to: string
  ariaLabel: string
  title: string
  subtitle: string
  trailing: string
  previewUrl: string | null
  previewAlt: string
  eager?: boolean
  priority?: boolean
  footer?: string
  thumbnail?: boolean
}

export interface AssetPreviewSurfaceProps {
  previewUrl: string | null
  previewAlt: string
  eager?: boolean
  priority?: boolean
  className?: string
  thumbnail?: boolean
}

type AssetThumbnailImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string
}

/** 新资产先读固定兄弟 key；历史对象缺图时退回原 URL，详情数据无需迁移。 */
export function AssetThumbnailImage({ src, onError, ...props }: AssetThumbnailImageProps) {
  const thumbnailUrl = cardThumbnailUrl(src)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)

  useEffect(() => setThumbnailFailed(false), [src])

  return (
    <img
      {...props}
      src={thumbnailUrl && !thumbnailFailed ? thumbnailUrl : src}
      onError={(event) => {
        if (thumbnailUrl && !thumbnailFailed) setThumbnailFailed(true)
        onError?.(event)
      }}
    />
  )
}

function cardThumbnailUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl)
    if (url.search || url.hash) return null
    if (!/\/media\/(?:reference-image|outfit-preview)\//.test(url.pathname)) return null
    const slash = url.pathname.lastIndexOf('/')
    const dot = url.pathname.lastIndexOf('.')
    const stem =
      url.pathname.endsWith('.source') || dot <= slash ? url.pathname : url.pathname.slice(0, dot)
    if (!stem.endsWith('.source')) return null
    url.pathname = `${stem.slice(0, -'.source'.length)}.card.webp`
    return url.toString()
  } catch {
    return null
  }
}

/** 所有造型入口共用同一份真实图片与缺图状态。 */
export function AssetPreviewSurface({
  previewUrl,
  previewAlt,
  priority = false,
  eager = priority,
  className = '',
  thumbnail = false,
}: AssetPreviewSurfaceProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-[1.25rem] border border-app-line bg-app-surface-muted ${className}`}
    >
      {previewUrl ? (
        thumbnail ? (
          <AssetThumbnailImage
            src={previewUrl}
            alt={previewAlt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            className="h-full w-full object-contain p-6 [image-rendering:pixelated]"
          />
        ) : (
          <img
            src={previewUrl}
            alt={previewAlt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            className="h-full w-full object-contain p-6 [image-rendering:pixelated]"
          />
        )
      ) : (
        <div className="relative h-full overflow-hidden bg-app-surface-muted">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-55"
            style={{
              backgroundImage:
                'linear-gradient(to right, var(--color-app-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-app-line) 1px, transparent 1px)',
              backgroundPosition: 'center center',
              backgroundSize: '24px 24px',
            }}
          />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-app-surface/85 px-2 py-1 font-mono text-[10px] tracking-[0.06em] whitespace-nowrap text-app-faint backdrop-blur-sm">
            暂无造型预览
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * 资产库与预览台共用的造型卡片；两处只决定跳转目标和尾部元信息。
 * 预览图、空状态和像素图像处理必须保持同一套行为，避免用户在两个入口看到两种资产真相。
 */
export function AssetPreviewCard({
  to,
  ariaLabel,
  title,
  subtitle,
  trailing,
  previewUrl,
  previewAlt,
  priority = false,
  eager = priority,
  footer,
  thumbnail = false,
}: AssetPreviewCardProps) {
  return (
    <article className="group/tile relative min-w-0">
      <Link
        to={to}
        aria-label={ariaLabel}
        className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ink"
      >
        <AssetPreviewSurface
          previewUrl={previewUrl}
          previewAlt={previewAlt}
          eager={eager}
          priority={priority}
          thumbnail={thumbnail}
          className="aspect-[16/10] transition duration-300 group-hover/tile:-translate-y-0.5 group-hover/tile:border-app-line-strong [&_img]:transition-transform [&_img]:duration-500 group-hover/tile:[&_img]:scale-[1.025]"
        />
        <div className="mt-3 min-w-0 px-0.5">
          <div className="flex min-w-0 items-baseline justify-between gap-4">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-app-ink">{title}</h3>
              {subtitle ? <p className="mt-1 truncate text-xs text-app-faint">{subtitle}</p> : null}
            </div>
            <span className="shrink-0 truncate text-xs text-app-faint">{trailing}</span>
          </div>
          {footer ? (
            <p className="mt-2 text-xs text-app-muted">
              {footer.split(' · ').map((part, index) => (
                <span key={`${part}-${index}`}>
                  {index > 0 ? <span aria-hidden="true"> · </span> : null}
                  <span>{part}</span>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </Link>
    </article>
  )
}
