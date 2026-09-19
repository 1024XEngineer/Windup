import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readStoredZip } from '../../src/zip-reader.js'

const zipPath = resolve(process.argv[2] ?? '../dist/windup-cocos-importer.zip')
const entries = readStoredZip(await readFile(zipPath))
const names = entries.map((entry) => entry.name)
for (const required of ['package.json', 'dist/main.js', 'dist/runtime/main.js', 'dist/runtime/importer/import-core.js']) {
  if (!names.includes(required)) throw new Error(`PACKAGE_FILE_MISSING: ${required}`)
}

const forbiddenName = names.find((name) => /(^|\/)(test|temp|\.tmp|node_modules)(\/|$)/i.test(name))
if (forbiddenName) throw new Error(`PACKAGE_FORBIDDEN_FILE: ${forbiddenName}`)

for (const entry of entries) {
  const text = new TextDecoder().decode(entry.data)
  if (/[A-Z]:\\|\/Users\/|tokenDigest"\s*:\s*"[0-9a-f]{64}"/i.test(text)) {
    throw new Error(`PACKAGE_LOCAL_OR_SECRET_DATA: ${entry.name}`)
  }
}

const metadata = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === 'package.json').data))
if (metadata.package_version !== 2 || metadata.main !== './dist/main.js') {
  throw new Error('PACKAGE_METADATA_INVALID')
}
if (metadata.contributions.menu.some((item) => item.path !== 'Windup')) {
  throw new Error('PACKAGE_MENU_PATH_INVALID')
}
console.log(`OK: ${zipPath} (${entries.length} files)`)
