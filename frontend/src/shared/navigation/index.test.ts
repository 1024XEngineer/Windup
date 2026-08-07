import { describe, expect, it } from 'vitest'

import { sanitizeInternalPath } from './index'

describe('sanitizeInternalPath', () => {
  const origin = 'https://windup.example'

  it('keeps a same-origin path with query and hash', () => {
    expect(sanitizeInternalPath('/projects?view=recent#asset-2', origin)).toBe(
      '/projects?view=recent#asset-2',
    )
  })

  it.each([null, '', 'projects', 'https://attacker.example/path'])(
    'rejects an absent or non-rooted value: %s',
    (value) => {
      expect(sanitizeInternalPath(value, origin)).toBeNull()
    },
  )

  it.each(['//attacker.example/path', '///attacker.example/path', '/\\attacker.example/path'])(
    'rejects protocol-relative and backslash forms: %s',
    (value) => {
      expect(sanitizeInternalPath(value, origin)).toBeNull()
    },
  )
})
