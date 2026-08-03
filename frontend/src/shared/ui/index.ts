/**
 * 从 asset-lab live demo 提炼出的纯展示组件。
 * 只接收调用方传入的数据，不读取 Router、运行状态、接口或浏览器存储，
 * 因此放在 shared 层，画布与后续页面都能用。
 */
export { AssetPreviewCard } from './asset-preview-card'
export type { AssetPreviewCardProps, AssetPreviewStatus } from './asset-preview-card'
export { FrameArrivalStrip } from './frame-arrival-strip'
export type { FrameArrival, FrameArrivalStripProps } from './frame-arrival-strip'
export { VisualOptionPicker } from './visual-option-picker'
export type { VisualOption, VisualOptionPickerProps } from './visual-option-picker'
