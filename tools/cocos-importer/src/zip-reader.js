// Minimal ZIP reader for STORED-only (no compression) ZIPs.
// Windup's asset-export.ts always writes stored (compression method 0) so this
// is sufficient and avoids pulling in a full ZIP library.
//
// Layout: https://pkware.files.wordpress.com/2024/06/appnote-6.0.0-20240424.pdf
//   [Local File Header + file data] * N
//   [Central Directory File Header] * N
//   [End of Central Directory Record]

import { IMPORT_LIMITS } from './limits.js'

/**
 * @typedef {{
 *   name: string,
 *   data: Uint8Array,
 *   size: number,
 * }} ZipEntry
 */

/**
 * @param {Uint8Array} bytes
 * @param {{maxEntries?:number, maxEntryBytes?:number, maxTotalBytes?:number}} [limits]
 * @returns {ZipEntry[]}
 */
export function readStoredZip(bytes, limits = {}) {
  const maxEntries = limits.maxEntries ?? IMPORT_LIMITS.zipEntries
  const maxEntryBytes = limits.maxEntryBytes ?? IMPORT_LIMITS.zipEntryBytes
  const maxTotalBytes = limits.maxTotalBytes ?? IMPORT_LIMITS.expandedBytes
  if (!(bytes instanceof Uint8Array) || bytes.length < 22) throw new Error('ZIP: 文件过短')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (off) => dv.getUint16(off, true)
  const u32 = (off) => dv.getUint32(off, true)
  const within = (offset, length, limit = bytes.length) =>
    Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset + length <= limit
  const decodeName = (nameBytes) => {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes)
    } catch {
      throw new Error('ZIP: 文件名不是合法 UTF-8')
    }
  }

  // Find End of Central Directory Record
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (u32(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP: 找不到 End of Central Directory Record')
  if (!within(eocd, 22)) throw new Error('ZIP: EOCD 不完整')
  const commentLength = u16(eocd + 20)
  if (!within(eocd, 22 + commentLength)) throw new Error('ZIP: EOCD 注释越界')
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 || u16(eocd + 8) !== u16(eocd + 10)) {
    throw new Error('ZIP: 不支持多磁盘压缩包')
  }

  const total = u16(eocd + 10)
  if (total > maxEntries) throw new Error(`ZIP: 条目数超过限制 ${maxEntries}`)
  const cdSize = u32(eocd + 12)
  const cdOffset = u32(eocd + 16)
  const cdEnd = cdOffset + cdSize
  if (!within(cdOffset, cdSize, eocd) || cdEnd !== eocd) throw new Error('ZIP: 中央目录越界')
  const entries = []
  const names = new Set()
  let totalBytes = 0

  let p = cdOffset
  for (let i = 0; i < total; i += 1) {
    if (!within(p, 46, cdEnd)) throw new Error(`ZIP: 中央目录条目越界 @${p}`)
    if (u32(p) !== 0x02014b50) throw new Error(`ZIP: 中央目录签名错 @${p}`)
    const hostSystem = u16(p + 4) >> 8
    const unixMode = u32(p + 38) >>> 16
    if (hostSystem === 3 && (unixMode & 0xf000) === 0xa000) {
      throw new Error('ZIP: 包含符号链接')
    }
    const compMethod = u16(p + 10)
    if (compMethod !== 0) {
      throw new Error(
        `ZIP: 不支持压缩方法 ${compMethod} (仅支持 STORED);${{
          8: 'Deflate',
          12: 'Bzip2',
          14: 'LZMA',
        }[compMethod] ?? ''}`,
      )
    }
    const flags = u16(p + 8)
    if ((flags & 0x0001) !== 0) throw new Error('ZIP: 不支持加密条目')
    if ((flags & 0x0008) !== 0) throw new Error('ZIP: 不支持数据描述符')
    const expectedCrc = u32(p + 16)
    const csize = u32(p + 20)
    const usize = u32(p + 24)
    if (csize !== usize) throw new Error('ZIP: STORED 条目压缩前后大小不一致')
    if (usize > maxEntryBytes) throw new Error(`ZIP: 单条目超过限制 ${maxEntryBytes}`)
    totalBytes += usize
    if (totalBytes > maxTotalBytes) throw new Error(`ZIP: 总解包大小超过限制 ${maxTotalBytes}`)
    const fnLen = u16(p + 28)
    const exLen = u16(p + 30)
    const cmLen = u16(p + 32)
    const lhOffset = u32(p + 42)
    const centralLength = 46 + fnLen + exLen + cmLen
    if (!within(p, centralLength, cdEnd)) throw new Error(`ZIP: 中央目录字段越界 @${p}`)
    const nameBytes = bytes.subarray(p + 46, p + 46 + fnLen)
    const name = decodeName(nameBytes)
    assertSafeZipPath(name)
    if (names.has(name)) throw new Error(`ZIP: 包含重复路径: ${name}`)
    names.add(name)
    p += centralLength

    // Local file header
    if (!within(lhOffset, 30, cdOffset)) throw new Error(`ZIP: 本地头越界 @${lhOffset}`)
    if (u32(lhOffset) !== 0x04034b50) throw new Error(`ZIP: 本地头签名错 @${lhOffset}`)
    if (u16(lhOffset + 6) !== flags) throw new Error(`ZIP: 本地头标志不一致: ${name}`)
    if (u16(lhOffset + 8) !== compMethod) throw new Error(`ZIP: 本地头压缩方法不一致: ${name}`)
    if (u32(lhOffset + 14) !== expectedCrc) throw new Error(`ZIP: 本地头 CRC 不一致: ${name}`)
    if (u32(lhOffset + 18) !== csize || u32(lhOffset + 22) !== usize) {
      throw new Error(`ZIP: 本地头大小不一致: ${name}`)
    }
    const lhFn = u16(lhOffset + 26)
    const lhEx = u16(lhOffset + 28)
    const dataStart = lhOffset + 30 + lhFn + lhEx
    if (!within(lhOffset, 30 + lhFn + lhEx + csize, cdOffset)) {
      throw new Error(`ZIP: 文件内容越界: ${name}`)
    }
    const localName = decodeName(bytes.subarray(lhOffset + 30, lhOffset + 30 + lhFn))
    if (localName !== name) throw new Error(`ZIP: 中央目录和本地头文件名不一致: ${name}`)
    const data = bytes.subarray(dataStart, dataStart + csize)
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP: CRC 校验失败: ${name}`)
    entries.push({ name, data, size: csize })
  }
  if (p !== cdEnd) throw new Error('ZIP: 中央目录大小不一致')
  return entries
}

/**
 * Extract entries to a flat list filtered by prefix. The root package directory
 * (e.g. "Hero-char-42-Ranger-outfit-7/") is stripped, leaving relative paths.
 *
 * @param {ZipEntry[]} entries
 * @returns {{relativePath: string, data: Uint8Array, size: number, rootDir: string}[]}
 */
export function flattenZipEntries(entries) {
  if (entries.length === 0) throw new Error('ZIP: 空包')
  const firstName = entries[0].name
  const slash = firstName.indexOf('/')
  if (slash < 0) throw new Error(`ZIP: 顶层条目没有包根目录: ${firstName}`)
  const rootDir = firstName.slice(0, slash)
  const prefix = `${rootDir}/`
  return entries
    .filter((e) => e.name.startsWith(prefix))
    .map((e) => ({
      rootDir,
      relativePath: e.name.slice(prefix.length),
      data: e.data,
      size: e.size,
    }))
}

function assertSafeZipPath(name) {
  if (
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')
  ) {
    throw new Error(`ZIP: 包内路径不安全: ${name}`)
  }
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
