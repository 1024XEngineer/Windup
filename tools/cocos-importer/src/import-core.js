import { readStoredZip, flattenZipEntries } from './zip-reader.js'
import { buildManifestFromLegacyMeta, parseManifest } from './manifest-reader.js'
import { planImport } from './asset-planner.js'
import { buildCocosMetaFiles, uuidForPath } from './cocos-bridge.js'
import { IMPORT_LIMITS } from './limits.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

/**
 * @typedef {{ relativePath: string, data: Uint8Array, size: number, rootDir: string }} FlatEntry
 * @typedef {{
 *   manifest: import('./manifest-reader.js').WindupCocosManifest,
 *   manifestText: string,
 *   plan: import('./asset-planner.js').ImportPlan,
 *   packFolder: string,
 *   files: Map<string, Uint8Array>,
 *   summary: { characterName: string, outfitName: string, animationCount: number, frameCount: number, fileCount: number },
 * }} PreparedImport
 */

/**
 * Convert a STORED Windup ZIP entirely in memory.
 * @param {Uint8Array} input
 * @returns {PreparedImport}
 */
export function prepareImport(input) {
  return prepareImportFromEntries(flattenZipEntries(readStoredZip(input)))
}

/**
 * Shared entry point for the ZIP adapter and the CLI's legacy frames adapter.
 * @param {FlatEntry[]} entries
 * @returns {PreparedImport}
 */
export function prepareImportFromEntries(entries) {
  if (entries.length === 0) throw new Error('IMPORT_EMPTY: 资产包没有文件')
  const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]))
  const manifestEntry = byPath.get('targets/cocos-creator/cocos-import.json')
  const legacyMetaEntry = byPath.get('meta.json')

  let manifest
  let manifestText
  if (manifestEntry) {
    manifestText = decoder.decode(manifestEntry.data)
    manifest = parseManifest(manifestText)
  } else if (legacyMetaEntry) {
    let legacy
    try {
      legacy = JSON.parse(decoder.decode(legacyMetaEntry.data))
    } catch (error) {
      throw new Error(`IMPORT_MANIFEST_INVALID: 旧版 meta.json 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    manifest = buildManifestFromLegacyMeta(legacy)
    manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  } else {
    throw new Error('IMPORT_MANIFEST_MISSING: 找不到 targets/cocos-creator/cocos-import.json 或 meta.json')
  }

  const plan = planImport(manifest)
  const files = new Map()
  const sources = []
  let expandedBytes = 0
  for (const spriteFrame of plan.spriteFrames) {
    const source = byPath.get(spriteFrame.sourcePath)
    if (!source) throw new Error(`IMPORT_SOURCE_MISSING: ${spriteFrame.sourcePath}`)
    expandedBytes += source.data.byteLength
    if (expandedBytes > IMPORT_LIMITS.expandedBytes) {
      throw new Error(`IMPORT_OUTPUT_TOO_LARGE: 素材展开超过 ${IMPORT_LIMITS.expandedBytes} 字节`)
    }
    sources.push([spriteFrame, source])
  }
  for (const [spriteFrame, source] of sources) {
    files.set(spriteFrame.cocosPath, copyBytes(source.data))
  }

  const generated = buildCocosMetaFiles(manifest, plan, entries[0].rootDir)
  for (const [path, text] of Object.entries(generated)) files.set(path, encoder.encode(text))

  for (const path of ['meta.json', 'schema.json', 'README.md']) {
    const entry = byPath.get(path)
    if (entry) files.set(`${plan.packFolder}/${path}`, copyBytes(entry.data))
  }
  files.set(`${plan.packFolder}/cocos-import.json`, encoder.encode(manifestText))
  addAuxiliaryMetaFiles(files, plan.packFolder)

  const prepared = {
    manifest,
    manifestText,
    plan,
    packFolder: plan.packFolder,
    files,
    summary: {
      characterName: manifest.package.character_name,
      outfitName: manifest.package.outfit_name,
      animationCount: plan.animations.length,
      frameCount: plan.animations.reduce((total, animation) => total + animation.frames.length, 0),
      fileCount: files.size,
    },
  }
  validatePreparedImport(prepared)
  return prepared
}

function addAuxiliaryMetaFiles(files, packFolder) {
  const assetPaths = [...files.keys()].filter((path) => !path.endsWith('.meta'))
  const directories = new Set()
  for (const path of assetPaths) {
    let directory = path.slice(0, path.lastIndexOf('/'))
    while (directory.startsWith(`${packFolder}/`)) {
      directories.add(directory)
      directory = directory.slice(0, directory.lastIndexOf('/'))
    }
  }
  for (const directory of directories) {
    const metaPath = `${directory}.meta`
    if (!files.has(metaPath)) files.set(metaPath, encoder.encode(auxiliaryMeta(directory, 'directory')))
  }
  for (const path of assetPaths) {
    const importer = path.endsWith('.json') ? 'json' : path.endsWith('.md') ? 'text' : null
    const metaPath = `${path}.meta`
    if (importer && !files.has(metaPath)) files.set(metaPath, encoder.encode(auxiliaryMeta(path, importer)))
  }
}

function auxiliaryMeta(path, importer) {
  return JSON.stringify(
    {
      ver: importer === 'directory' ? '1.2.0' : importer === 'json' ? '2.0.1' : '1.0.1',
      importer,
      imported: true,
      uuid: uuidForPath(path),
      files: importer === 'directory' ? [] : ['.json'],
      subMetas: {},
      userData: {},
    },
    null,
    2,
  )
}

/**
 * Validate output completeness and every serialized asset UUID reference.
 * @param {PreparedImport} prepared
 * @returns {PreparedImport['summary']}
 */
export function validatePreparedImport(prepared) {
  const required = new Set([
    ...prepared.plan.spriteFrames.flatMap((asset) => [asset.cocosPath, `${asset.cocosPath}.meta`]),
    ...prepared.plan.animations.flatMap((animation) => {
      const path = `${prepared.packFolder}/animations/${animation.name}.anim`
      return [path, `${path}.meta`]
    }),
    prepared.plan.prefab.cocosPath,
    `${prepared.plan.prefab.cocosPath}.meta`,
    `${prepared.packFolder}/cocos-import.json`,
  ])
  for (const path of required) {
    if (!prepared.files.has(path)) throw new Error(`IMPORT_OUTPUT_MISSING: ${path}`)
  }

  const definedUuids = new Set()
  for (const [path, bytes] of prepared.files) {
    if (!path.endsWith('.meta')) continue
    const meta = parseGeneratedJson(bytes, path)
    collectDefinedUuids(meta, definedUuids)
  }
  for (const [path, bytes] of prepared.files) {
    if (!path.endsWith('.anim') && !path.endsWith('.prefab')) continue
    const asset = parseGeneratedJson(bytes, path)
    for (const uuid of collectReferencedUuids(asset)) {
      if (!definedUuids.has(uuid)) throw new Error(`IMPORT_UUID_UNRESOLVED: ${path} -> ${uuid}`)
    }
  }
  return prepared.summary
}

function copyBytes(bytes) {
  return new Uint8Array(bytes)
}

function parseGeneratedJson(bytes, path) {
  try {
    return JSON.parse(decoder.decode(bytes))
  } catch (error) {
    throw new Error(`IMPORT_OUTPUT_JSON_INVALID: ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function collectDefinedUuids(value, output) {
  if (!value || typeof value !== 'object') return
  if (typeof value.uuid === 'string') output.add(value.uuid)
  if (value.subMetas && typeof value.subMetas === 'object') {
    for (const subMeta of Object.values(value.subMetas)) collectDefinedUuids(subMeta, output)
  }
}

function collectReferencedUuids(value, output = []) {
  if (!value || typeof value !== 'object') return output
  if (typeof value.__uuid__ === 'string') output.push(value.__uuid__)
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectReferencedUuids(child, output)
  }
  return output
}
