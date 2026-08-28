// 快照一个目录里所有 .meta / .prefab / .anim 的关键字段(UUID 引用、SpriteFrame 子资源)。
// 用法: node test/snapshot-uuids.mjs <dir> <out.json>
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const dir = resolve(process.cwd(), process.argv[2])
const out = resolve(process.cwd(), process.argv[3])

function walk(d) {
  const out = []
  for (const n of readdirSync(d)) {
    const f = join(d, n)
    const s = statSync(f)
    if (s.isDirectory()) out.push(...walk(f))
    else out.push(f)
  }
  return out
}

function collectUuids(obj, acc, path) {
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectUuids(v, acc, `${path}[${i}]`))
    return
  }
  if (obj && typeof obj === 'object') {
    if (typeof obj.__uuid__ === 'string') acc.push({ path, uuid: obj.__uuid__ })
    for (const k of Object.keys(obj)) collectUuids(obj[k], acc, `${path}.${k}`)
  }
}

const snap = {}
for (const f of walk(dir)) {
  if (!f.endsWith('.meta') && !f.endsWith('.prefab') && !f.endsWith('.anim')) continue
  const rel = relative(dir, f).replace(/\\/g, '/')
  try {
    const j = JSON.parse(readFileSync(f, 'utf-8'))
    const uuids = []
    collectUuids(j, uuids, '$')
    const ownUuid = j.uuid ?? null
    const subMetaUuids = j.subMetas && typeof j.subMetas === 'object'
      ? Object.fromEntries(
          Object.entries(j.subMetas)
            .filter(([, value]) => value && typeof value.uuid === 'string')
            .map(([name, value]) => [name, value.uuid]),
        )
      : {}
    snap[rel] = { ownUuid, subMetaUuids, uuids }
  } catch (err) {
    snap[rel] = { error: err.message }
  }
}

import { writeFileSync } from 'node:fs'
writeFileSync(out, JSON.stringify(snap, null, 2))
console.log(`snap: ${Object.keys(snap).length} files → ${out}`)
