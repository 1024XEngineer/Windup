declare const mediaReferenceBrand: unique symbol

/**
 * 已上传媒体的不透明引用。
 * 当前不承诺运行时字符串代表 URL、media_id 或其他后端标识。
 */
export type MediaReference = string & {
  readonly [mediaReferenceBrand]: 'MediaReference'
}

/** 上传媒体时的业务用途；值与后端 MediaCategory 枚举逐项对应。 */
export type MediaCategory = 'reference-image' | 'outfit-preview' | 'action-frame' | 'general'

/**
 * 媒体实体对页面和生成流程暴露的最小能力。
 * signal 用于页面离开、用户取消或新上传替换旧上传时终止仍在途的请求。
 */
export interface MediaApis {
  upload(file: File, category?: MediaCategory, signal?: AbortSignal): Promise<MediaReference>
}

// 上层只能通过 @/entities 公共入口取得真实适配器，避免页面深度导入内部文件。
export { createMediaApis, MediaContractError } from './api'
