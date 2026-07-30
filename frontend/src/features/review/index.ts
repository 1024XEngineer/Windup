/**
 * 逐帧查看已生成的动作，供用户在导出前过一遍。
 *
 * 只看不改：服务端不返回质检结论，产品上也不设「打回此帧」，
 * 所以这里没有任何写操作，帧数据不会因为查看而改变。
 */
export interface ReviewProps {
  /** 动作 ID 只在造型内唯一，调用方须自行持有所属造型，不能拿它跨角色定位。 */
  actionId: string
  frameIndex: number
  onSelectFrame(index: number): void
}
