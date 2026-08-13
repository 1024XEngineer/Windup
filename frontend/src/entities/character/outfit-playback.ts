import type { Outfit } from './index'

/** Playtest 入口与工作台共用这一条边界：动作元数据存在不等于已有帧可以播放。 */
export function getOutfitPlayback(outfit: Outfit) {
  const frameCount = outfit.actions.reduce((total, action) => total + action.frames.length, 0)
  return { frameCount, playable: frameCount > 0 }
}
