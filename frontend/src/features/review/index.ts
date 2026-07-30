/** 逐帧审核：打回有问题的帧。不设「通过此帧」，默认通过。 */
export interface ReviewProps {
  actionId: string
  frameIndex: number
  onSelectFrame(index: number): void
  onRejectFrame(index: number): void
}
