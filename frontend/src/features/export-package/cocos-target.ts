import type { ExportAnchor } from './model'

/**
 * Issue #94 的 Cocos 原生文件格式仍等待真实 Creator 3.x 实测。
 * 这里公开状态，避免页面或调用方把通用包误标成“Cocos 拖入即用包”。
 */
export const COCOS_TARGET_READINESS = {
  ready: false,
  reason: '等待真实 Cocos Creator 3.x 验证 .anim、.meta、UUID 与图集切分格式',
} as const

/** 通用层左上原点转为 Cocos Creator 左下原点；x 不变，y 上下翻转。 */
export function toCocosAnchor(anchor: ExportAnchor): ExportAnchor {
  return { x: anchor.x, y: 1 - anchor.y }
}
