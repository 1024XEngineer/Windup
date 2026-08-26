import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'

export const IMAGE_UPLOAD_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
export const IMAGE_UPLOAD_HINT = '支持 PNG、JPG、GIF、WEBP，单张不超过 10 MB'

const IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
const IMAGE_UPLOAD_TYPES = new Set(IMAGE_UPLOAD_ACCEPT.split(','))

export interface ImageDropTargetOptions {
  disabled?: boolean
  onFile(file: File): void
  onError(message: string): void
}

export function imageUploadError(file: File): string | null {
  if (!IMAGE_UPLOAD_TYPES.has(file.type)) return '仅支持 PNG、JPG、GIF、WEBP 图片'
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) return '图片不能超过 10 MB'
  return null
}

function isFileDrag(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes('Files')
}

export function useImageDropTarget({ disabled = false, onFile, onError }: ImageDropTargetOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    if (!disabled) return
    dragDepth.current = 0
    setIsDragging(false)
  }, [disabled])

  const selectFile = useCallback(
    (file: File) => {
      if (disabled) return false
      const message = imageUploadError(file)
      if (message) {
        onError(message)
        return false
      }
      onFile(file)
      return true
    },
    [disabled, onError, onFile],
  )

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      if (disabled) return
      dragDepth.current += 1
      setIsDragging(true)
    },
    [disabled],
  )

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
  }, [])

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      dragDepth.current = 0
      setIsDragging(false)
      const file = event.dataTransfer.files[0]
      if (file) selectFile(file)
    },
    [selectFile],
  )

  return {
    isDragging,
    selectFile,
    dropTargetProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  } as const
}
