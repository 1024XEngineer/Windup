/** 前端图片生成能力所需的稳定业务输入；不表达后端 URL 或 DTO 壳。 */
export interface GenerateImagesInput {
  /** 本次生成归属的真实 Project ID。 */
  projectId: string
  /** 已由手动输入或 Quick Start Agent 整理好的生成提示词。 */
  prompt: string
  /** 可选参考图 URL；没有参考图时传空数组。 */
  referenceImageUrls: string[]
}

/** 后端当前能交付给前端的最小图片结果。 */
export interface GeneratedImage {
  /** 可供预览或后续资产登记使用的图片 URL。 */
  url: string
}
