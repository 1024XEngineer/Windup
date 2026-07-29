import type { MediaReference } from '@/entities'

/**
 * 图片上传的业务能力端口。
 * 调用方只提交浏览器文件并接收不透明媒体引用，不预设 URL、media_id、multipart 或响应壳。
 */
export interface ImageUploadPort {
  upload(file: File): Promise<MediaReference>
}
