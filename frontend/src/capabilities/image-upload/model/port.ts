/** 图片上传 Adapter 来源，用于阻止生产配置误接开发 Mock。 */
export type ImageUploadAdapterKind = 'real' | 'mock'

/**
 * 图片上传的业务能力端口。
 * 调用方只提交浏览器文件并接收可持久化 URL，不感知 multipart 与后端响应壳。
 */
export interface ImageUploadPort {
  readonly adapterKind: ImageUploadAdapterKind
  upload(file: File): Promise<string>
}
