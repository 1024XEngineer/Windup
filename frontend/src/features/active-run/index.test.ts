// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunStorage,
  forgetActiveRun,
  readActiveRun,
  rememberActiveRun,
  syncActiveRun,
  type ActiveRunNodeSnapshot,
} from './index'

afterEach(() => {
  window.localStorage.clear()
})

describe('活跃生成任务的本地指针', () => {
  it('记住后可以在任意页面读回同一个 runId', () => {
    rememberActiveRun('7', '42')

    expect(readActiveRun('7')).toBe('42')
  })

  it('只清除仍指向同一条任务的指针，晚到的旧任务回调不误伤新任务', () => {
    rememberActiveRun('7', '42')
    rememberActiveRun('7', '99')

    forgetActiveRun('7', '42')

    expect(readActiveRun('7')).toBe('99')
  })

  it('清除当前任务后不再提供返回入口', () => {
    rememberActiveRun('7', '42')

    forgetActiveRun('7', '42')

    expect(readActiveRun('7')).toBeNull()
  })

  it('没有记录时返回空', () => {
    expect(readActiveRun('7')).toBeNull()
  })

  it('不同登录用户不会读到彼此的任务', () => {
    rememberActiveRun('7', '42')

    expect(readActiveRun('8')).toBeNull()
  })

  it('浏览器拒绝 localStorage 时退回内存指针', () => {
    const storage = createActiveRunStorage({
      getItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError')
      }),
      setItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError')
      }),
      removeItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError')
      }),
    })

    storage.remember('7', '42')

    expect(storage.read('7')).toBe('42')
    expect(() => storage.forget('7', '42')).not.toThrow()
    expect(storage.read('7')).toBeNull()
  })
})

function node(overrides: Partial<ActiveRunNodeSnapshot> = {}): ActiveRunNodeSnapshot {
  return { status: 'active', phase: 'generating', deletedAt: null, ...overrides }
}

describe('按工作流快照同步指针', () => {
  it('有节点正在生成时记住这条任务', () => {
    syncActiveRun('7', { id: '42', nodes: [node({ phase: 'ready' }), node()] })

    expect(readActiveRun('7')).toBe('42')
  })

  it('没有节点在生成时清除这条任务', () => {
    rememberActiveRun('7', '42')

    syncActiveRun('7', { id: '42', nodes: [node({ phase: 'selecting' })] })

    expect(readActiveRun('7')).toBeNull()
  })

  it('已归档的生成节点不算进行中', () => {
    syncActiveRun('7', {
      id: '42',
      nodes: [node({ deletedAt: '2026-08-20T00:00:00Z' })],
    })

    expect(readActiveRun('7')).toBeNull()
  })

  it('还没有工作流时不动已有指针', () => {
    rememberActiveRun('7', '42')

    syncActiveRun('7', null)

    expect(readActiveRun('7')).toBe('42')
  })
})
