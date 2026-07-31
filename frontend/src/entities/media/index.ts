declare const mediaReferenceBrand: unique symbol

/**
 * 已上传媒体的不透明引用。
 * 当前不承诺运行时字符串代表 URL、media_id 或其他后端标识。
 */
export type MediaReference = string & {
  readonly [mediaReferenceBrand]: 'MediaReference'
}
