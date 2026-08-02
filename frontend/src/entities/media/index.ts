declare const mediaReferenceBrand: unique symbol

/**
 * 已上传媒体的不透明引用。
 * 当前不承诺运行时字符串代表 URL、media_id 或其他后端标识。
 */
export type MediaReference = string & {
  readonly [mediaReferenceBrand]: 'MediaReference'
}

/** 上传媒体时的业务用途；后端据此选择存储目录和校验规则。 */
export type MediaCategory = 'reference-image' | 'outfit-preview' | 'action-frame' | 'general'

/** 媒体实体对应的后端能力。 */
export interface MediaApis {
  upload(file: File, category?: MediaCategory): Promise<MediaReference>
}
