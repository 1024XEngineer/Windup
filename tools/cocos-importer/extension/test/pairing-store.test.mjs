import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PairingStore } from '../source/pairing-store.js'

class MemoryProfile {
  value = null

  async load() {
    return this.value
  }

  async save(value) {
    this.value = value
  }
}

function store({ now = 1_000, profile = new MemoryProfile() } = {}) {
  let clock = now
  const instance = new PairingStore({
    profile,
    now: () => clock,
    randomCode: () => '123456',
    randomToken: () => 'a'.repeat(64),
  })
  return { instance, profile, advance: (milliseconds) => (clock += milliseconds) }
}

test('PairingStore issues a six-digit code valid for five minutes', () => {
  const { instance, advance } = store()
  assert.equal(instance.createCode(), '123456')
  assert.equal(instance.hasActiveCode(), true)
  advance(5 * 60_000 + 1)
  assert.equal(instance.hasActiveCode(), false)
})

test('PairingStore stores only token digest and authorizes exact origin', async () => {
  const { instance, profile } = store()
  instance.createCode()
  const token = await instance.pair('123456', 'https://windup.example')

  assert.equal(token, 'a'.repeat(64))
  assert.equal(profile.value.origin, 'https://windup.example')
  assert.notEqual(profile.value.tokenDigest, token)
  assert.equal(profile.value.tokenDigest.length, 64)
  assert.equal(await instance.authorize('https://windup.example', token), true)
  assert.equal(await instance.authorize('https://evil.example', token), false)
  assert.equal(await instance.authorize('https://windup.example', 'b'.repeat(64)), false)
})

test('PairingStore invalidates a code after five wrong attempts', async () => {
  const { instance } = store()
  instance.createCode()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(() => instance.pair('000000', 'https://windup.example'), /PAIR_CODE_INVALID/)
  }
  await assert.rejects(() => instance.pair('000000', 'https://windup.example'), /PAIR_CODE_LOCKED/)
  await assert.rejects(() => instance.pair('123456', 'https://windup.example'), /PAIR_CODE_EXPIRED/)
})

test('PairingStore consumes a successful code and restores persisted pairing', async () => {
  const first = store()
  first.instance.createCode()
  await first.instance.pair('123456', 'https://windup.example')
  await assert.rejects(
    () => first.instance.pair('123456', 'https://windup.example'),
    /PAIR_CODE_EXPIRED/,
  )

  const restored = store({ profile: first.profile }).instance
  assert.equal(await restored.isOriginAllowed('https://windup.example'), true)
  assert.equal(await restored.isOriginAllowed('https://other.example'), false)
})
