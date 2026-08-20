import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const extensionDir = resolve(scriptDir, '..')
const importerDir = resolve(extensionDir, '..')
const outputDir = resolve(importerDir, 'dist')
const stagingDir = resolve(outputDir, '.extension-build')
const zipPath = resolve(outputDir, 'windup-cocos-importer.zip')

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

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

async function listFiles(root, directory = root) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)))
    else files.push({ name: relative(root, path).replaceAll('\\', '/'), data: await readFile(path) })
  }
  return files
}

async function copyRuntime(source, destination) {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue
    let contents = await readFile(join(source, entry.name), 'utf8')
    if (entry.name === 'main.js') {
      contents = contents.replace("'../../src/import-core.js'", "'./importer/import-core.js'")
    }
    await writeFile(join(destination, entry.name), contents)
  }
}

await rm(stagingDir, { recursive: true, force: true })
await mkdir(join(stagingDir, 'dist', 'runtime'), { recursive: true })
await copyRuntime(join(extensionDir, 'source'), join(stagingDir, 'dist', 'runtime'))
await copyRuntime(join(importerDir, 'src'), join(stagingDir, 'dist', 'runtime', 'importer'))

const sourcePackage = JSON.parse(await readFile(join(extensionDir, 'package.json'), 'utf8'))
delete sourcePackage.scripts
delete sourcePackage.type
sourcePackage.main = './dist/main.js'
await writeFile(join(stagingDir, 'package.json'), `${JSON.stringify(sourcePackage, null, 2)}\n`)
await writeFile(
  join(stagingDir, 'dist', 'main.js'),
  `"use strict"\nlet runtime\nasync function getRuntime() { return runtime ??= import('./runtime/main.js') }\nexports.methods = {\n  async showPairingCode() { return (await getRuntime()).methods.showPairingCode() },\n  async showConnectionStatus() { return (await getRuntime()).methods.showConnectionStatus() },\n}\nexports.load = async function load() { return (await getRuntime()).load() }\nexports.unload = async function unload() { return (await getRuntime()).unload() }\n`,
)
await writeFile(join(stagingDir, 'dist', 'runtime', 'package.json'), '{"type":"module"}\n')

const files = await listFiles(stagingDir)
await mkdir(outputDir, { recursive: true })
await writeFile(zipPath, storedZip(files))
await rm(stagingDir, { recursive: true, force: true })
console.log(zipPath)
