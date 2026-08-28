import { createHash } from 'node:crypto'
import { lstat, mkdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FILE_SYSTEM = { lstat, mkdir, rename, rm, rmdir, writeFile }
const PUBLIC_IMPORT_CODES = new Set([
  'IMPORT_ABORTED',
  'IMPORT_PATH_FORBIDDEN',
  'IMPORT_PATH_SYMLINK',
  'IMPORT_SHA256_MISMATCH',
  'IMPORT_VERIFY_FAILED',
])

async function pathExists(fileSystem, path) {
  try {
    await fileSystem.lstat(path)
    return true
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false
    throw cause
  }
}

function assertWithin(root, path) {
  const offset = relative(resolve(root), resolve(path))
  if (offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))) return
  throw new Error(`IMPORT_PATH_FORBIDDEN: ${path}`)
}

async function assertNoSymlinkPath(fileSystem, root, path) {
  assertWithin(root, path)
  const segments = relative(resolve(root), resolve(path)).split(sep).filter(Boolean)
  let current = resolve(root)
  for (const segment of ['', ...segments]) {
    if (segment) current = join(current, segment)
    try {
      if ((await fileSystem.lstat(current)).isSymbolicLink()) throw new Error(`IMPORT_PATH_SYMLINK: ${current}`)
    } catch (cause) {
      if (cause?.code === 'ENOENT') return
      throw cause
    }
  }
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.includes('\\')) throw new Error(`IMPORT_PATH_FORBIDDEN: ${value}`)
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`IMPORT_PATH_FORBIDDEN: ${value}`)
  }
  return segments.join(sep)
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error('IMPORT_ABORTED')
}

async function removeEmptyDirectory(fileSystem, path) {
  try {
    await fileSystem.rmdir(path)
  } catch (cause) {
    if (cause?.code !== 'ENOENT' && cause?.code !== 'ENOTEMPTY') throw cause
  }
}

function importFailure(cause, rolledBack, overrideCode) {
  const message = cause instanceof Error ? cause.message : String(cause)
  const candidate = /^([A-Z][A-Z0-9_]+)(?::|$)/.exec(message)?.[1]
  const error = new Error(message, { cause })
  error.code = overrideCode ?? (PUBLIC_IMPORT_CODES.has(candidate) ? candidate : 'IMPORT_FAILED')
  error.rolledBack = rolledBack
  return error
}

export class ImportJobRunner {
  #projectPath
  #assets
  #prepareImport
  #fileSystem
  #requests = new Map()

  constructor({ projectPath, assets, prepareImport, fileSystem = {} }) {
    this.#projectPath = resolve(projectPath)
    this.#assets = assets
    this.#prepareImport = prepareImport
    this.#fileSystem = { ...FILE_SYSTEM, ...fileSystem }
  }

  run(request) {
    const existing = this.#requests.get(request.requestId)
    if (existing) {
      if (existing.sha256 !== request.sha256) return Promise.reject(new Error('IMPORT_REQUEST_ID_CONFLICT'))
      return existing.promise
    }
    const promise = this.#execute(request)
    this.#requests.set(request.requestId, { sha256: request.sha256, promise })
    void promise.finally(() => this.#requests.delete(request.requestId)).catch(() => {})
    return promise
  }

  async #execute({ requestId, zipBytes, sha256, onPhase = () => {}, signal }) {
    if (!REQUEST_ID.test(requestId)) throw new Error('IMPORT_REQUEST_ID_INVALID')
    const actualSha = createHash('sha256').update(zipBytes).digest('hex')
    if (actualSha !== sha256) throw new Error('IMPORT_SHA256_MISMATCH')

    throwIfAborted(signal)
    onPhase('converting')
    const prepared = this.#prepareImport(zipBytes)
    const packRelative = safeRelativePath(prepared.packFolder)
    if (!prepared.packFolder.startsWith('windup-imports/')) {
      throw new Error(`IMPORT_PATH_FORBIDDEN: ${prepared.packFolder}`)
    }

    const assetsRoot = join(this.#projectPath, 'assets')
    const importRoot = join(assetsRoot, 'windup-imports')
    const destination = join(assetsRoot, packRelative)
    assertWithin(importRoot, destination)

    const tempRoot = join(this.#projectPath, 'temp', 'windup-importer')
    const transactionRoot = join(tempRoot, requestId)
    const outputRoot = join(transactionRoot, 'output')
    const stagedPack = join(outputRoot, packRelative)
    const backup = join(transactionRoot, 'backup')
    assertWithin(tempRoot, transactionRoot)

    let backupCreated = false
    let installed = false
    const dbFolder = `db://assets/${prepared.packFolder}`
    const prefabDbUrl = `db://assets/${prepared.plan.prefab.cocosPath}`

    try {
      await assertNoSymlinkPath(this.#fileSystem, this.#projectPath, destination)
      await assertNoSymlinkPath(this.#fileSystem, this.#projectPath, transactionRoot)
      await this.#fileSystem.rm(transactionRoot, { recursive: true, force: true })
      for (const [filePath, bytes] of prepared.files) {
        throwIfAborted(signal)
        const fileRelative = safeRelativePath(filePath)
        if (filePath !== prepared.packFolder && !filePath.startsWith(`${prepared.packFolder}/`)) {
          throw new Error(`IMPORT_PATH_FORBIDDEN: ${filePath}`)
        }
        const stagedFile = join(outputRoot, fileRelative)
        assertWithin(stagedPack, stagedFile)
        await this.#fileSystem.mkdir(dirname(stagedFile), { recursive: true })
        await this.#fileSystem.writeFile(stagedFile, bytes)
      }

      throwIfAborted(signal)
      onPhase('writing')
      await this.#fileSystem.mkdir(dirname(destination), { recursive: true })
      if (await pathExists(this.#fileSystem, destination)) {
        await this.#fileSystem.rename(destination, backup)
        backupCreated = true
      }
      await this.#fileSystem.rename(stagedPack, destination)
      installed = true

      throwIfAborted(signal)
      onPhase('refreshing')
      await this.#assets.refresh(dbFolder)

      throwIfAborted(signal)
      onPhase('verifying')
      const requiredDbUrls = [
        prefabDbUrl,
        ...prepared.plan.animations.map(
          (animation) => `db://assets/${prepared.packFolder}/animations/${animation.name}.anim`,
        ),
      ]
      for (const dbUrl of requiredDbUrls) {
        throwIfAborted(signal)
        if (!(await this.#assets.query(dbUrl))) throw new Error(`IMPORT_VERIFY_FAILED: ${dbUrl}`)
      }
      await this.#assets.reveal(prefabDbUrl)

      await this.#fileSystem.rm(transactionRoot, { recursive: true, force: true })
      await removeEmptyDirectory(this.#fileSystem, tempRoot)
      return {
        dbUrl: prefabDbUrl,
        animationCount: prepared.summary.animationCount,
        frameCount: prepared.summary.frameCount,
      }
    } catch (cause) {
      const rollbackNeeded = installed || backupCreated
      const rollbackErrors = []
      if (installed) {
        try {
          await this.#fileSystem.rm(destination, { recursive: true, force: true })
        } catch (error) {
          rollbackErrors.push(error)
        }
      }
      if (backupCreated) {
        try {
          if (await pathExists(this.#fileSystem, backup)) {
            await this.#fileSystem.mkdir(dirname(destination), { recursive: true })
            await this.#fileSystem.rename(backup, destination)
          } else {
            rollbackErrors.push(new Error('IMPORT_BACKUP_MISSING'))
          }
        } catch (error) {
          rollbackErrors.push(error)
        }
      }
      if (rollbackNeeded) {
        try {
          await this.#assets.refresh(dbFolder)
        } catch (error) {
          rollbackErrors.push(error)
        }
      }
      try {
        await this.#fileSystem.rm(transactionRoot, { recursive: true, force: true })
      } catch {
        // Cleanup is best-effort and does not change whether the user asset was restored.
      }
      try {
        await removeEmptyDirectory(this.#fileSystem, tempRoot)
      } catch {
        // Keep any stale transaction data for diagnosis; user assets are already restored.
      }
      if (rollbackErrors.length > 0) {
        throw importFailure(cause, false, 'IMPORT_ROLLBACK_FAILED')
      }
      throw importFailure(cause, rollbackNeeded)
    }
  }
}
