import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

const PROTOCOL = 'windup-cocos-bridge/1.0.0'

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1]
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'))
    const data = Buffer.from(entry.data)
    const checksum = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    localParts.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + data.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

async function packageEntries(packageRoot, directory = packageRoot) {
  const rootName = basename(packageRoot)
  const entries = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`FIXTURE_SYMLINK_FORBIDDEN: ${path}`)
    if (item.isDirectory()) entries.push(...(await packageEntries(packageRoot, path)))
    else if (item.isFile()) {
      entries.push({
        name: `${rootName}/${relative(packageRoot, path).replaceAll('\\', '/')}`,
        data: await readFile(path),
      })
    }
  }
  return entries
}

async function requestJson(url, init) {
  const response = await fetch(url, init)
  const body = await response.json()
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`)
  return body
}

async function main() {
  const code = option('--code')
  const frames = option('--frames')
  const origin = option('--origin') ?? 'http://localhost:4173'
  const baseUrl = option('--bridge') ?? 'http://127.0.0.1:17832'
  const repeat = Number(option('--repeat') ?? 1)
  if (!/^\d{6}$/.test(code ?? '')) throw new Error('--code 必须是六位连接码')
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 3) throw new Error('--repeat 必须是 1 到 3')
  if (!frames || basename(resolve(frames)).toLowerCase() !== 'frames') {
    throw new Error('--frames 必须指向资产包的 frames 目录')
  }

  const packageRoot = dirname(resolve(frames))
  const entries = await packageEntries(packageRoot)
  const zipBytes = storedZip(entries)
  const sha256 = createHash('sha256').update(zipBytes).digest('hex')
  const pairing = await requestJson(`${baseUrl}/v1/pair`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const attempts = []
  for (let attempt = 1; attempt <= repeat; attempt += 1) {
    const requestId = randomUUID()
    const submitted = await requestJson(`${baseUrl}/v1/imports`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: `Bearer ${pairing.token}`,
        'Content-Type': 'application/zip',
        'X-Windup-Protocol': PROTOCOL,
        'X-Windup-Request-Id': requestId,
        'X-Windup-SHA256': sha256,
      },
      body: zipBytes,
    })

    let previousPhase = null
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const job = await requestJson(`${baseUrl}/v1/imports/${submitted.jobId}`, {
        headers: {
          Origin: origin,
          Authorization: `Bearer ${pairing.token}`,
          'X-Windup-Protocol': PROTOCOL,
        },
      })
      if (job.phase !== previousPhase) {
        console.log(`attempt ${attempt}: ${job.status}: ${job.phase}`)
        previousPhase = job.phase
      }
      if (job.status === 'completed') {
        attempts.push({ requestId, jobId: job.jobId, result: job.result })
        break
      }
      if (job.status === 'failed') throw new Error(JSON.stringify(job.error))
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (attempts.length !== attempt) throw new Error('IMPORT_JOB_TIMEOUT')
  }
  console.log(JSON.stringify({ zipBytes: zipBytes.length, attempts }, null, 2))
}

await main()
