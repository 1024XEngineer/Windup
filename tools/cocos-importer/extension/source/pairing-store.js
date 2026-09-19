import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

const CODE_TTL_MS = 5 * 60_000
const MAX_ATTEMPTS = 5

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function validOrigin(origin) {
  if (typeof origin !== 'string') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === origin
  } catch {
    return false
  }
}

function equalDigest(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export class PairingStore {
  #profile
  #now
  #randomCode
  #randomToken
  #code = null

  constructor({
    profile,
    now = Date.now,
    randomCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0'),
    randomToken = () => randomBytes(32).toString('hex'),
  }) {
    if (!profile?.load || !profile?.save) throw new Error('PAIR_PROFILE_REQUIRED')
    this.#profile = profile
    this.#now = now
    this.#randomCode = randomCode
    this.#randomToken = randomToken
  }

  createCode() {
    const value = this.#randomCode()
    if (!/^\d{6}$/.test(value)) throw new Error('PAIR_CODE_INVALID_FORMAT')
    this.#code = { value, expiresAt: this.#now() + CODE_TTL_MS, attempts: 0 }
    return value
  }

  hasActiveCode() {
    return this.#code !== null && this.#code.attempts < MAX_ATTEMPTS && this.#now() <= this.#code.expiresAt
  }

  async pair(code, origin) {
    if (!this.hasActiveCode()) {
      this.#code = null
      throw new Error('PAIR_CODE_EXPIRED')
    }
    if (!validOrigin(origin)) throw new Error('PAIR_ORIGIN_INVALID')
    if (code !== this.#code.value) {
      this.#code.attempts += 1
      if (this.#code.attempts >= MAX_ATTEMPTS) throw new Error('PAIR_CODE_LOCKED')
      throw new Error('PAIR_CODE_INVALID')
    }

    const token = this.#randomToken()
    await this.#profile.save({ origin, tokenDigest: digest(token) })
    this.#code = null
    return token
  }

  async authorize(origin, token) {
    if (!validOrigin(origin) || typeof token !== 'string') return false
    const pairing = await this.#profile.load()
    return (
      pairing?.origin === origin &&
      typeof pairing.tokenDigest === 'string' &&
      equalDigest(pairing.tokenDigest, digest(token))
    )
  }

  async isOriginAllowed(origin) {
    if (!validOrigin(origin)) return false
    return (await this.#profile.load())?.origin === origin
  }
}
