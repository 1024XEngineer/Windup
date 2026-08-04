import { describe, expect, it } from 'vitest'

import { reduceAuditSession, type ManualAuditIssue } from './audit-session'

const issue: ManualAuditIssue = {
  id: 'issue-1',
  category: 'subject_cropped',
  actionId: 'walk',
  direction: 'south',
  frameIndex: 2,
  imageUrl: '/walk-03.png',
  note: '右侧被裁切',
}

describe('reduceAuditSession', () => {
  it('adds, updates and removes manual issues without mutating identity fields', () => {
    const added = reduceAuditSession([], { type: 'add', issue })
    const updated = reduceAuditSession(added, {
      type: 'update',
      id: issue.id,
      category: 'style_inconsistent',
      note: '衣服颜色跳变',
    })
    const removed = reduceAuditSession(updated, { type: 'remove', id: issue.id })

    expect(added).toEqual([issue])
    expect(updated[0]).toEqual({
      ...issue,
      category: 'style_inconsistent',
      note: '衣服颜色跳变',
    })
    expect(updated[0]).toMatchObject({
      actionId: 'walk',
      direction: 'south',
      frameIndex: 2,
      imageUrl: '/walk-03.png',
    })
    expect(removed).toEqual([])
    expect(added).not.toBe(updated)
  })

  it('ignores updates and removals for unknown issue ids', () => {
    expect(
      reduceAuditSession([issue], {
        type: 'update',
        id: 'missing',
        category: 'other',
        note: '无效更新',
      }),
    ).toEqual([issue])
    expect(reduceAuditSession([issue], { type: 'remove', id: 'missing' })).toEqual([issue])
  })
})
