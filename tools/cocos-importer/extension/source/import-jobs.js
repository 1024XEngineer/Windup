import { randomUUID } from 'node:crypto'

import { PROTOCOL } from './protocol.js'

function publicJob(job) {
  const output = {
    protocol: PROTOCOL,
    jobId: job.jobId,
    status: job.status,
    phase: job.phase,
  }
  if (job.result) output.result = job.result
  if (job.error) output.error = job.error
  return output
}

const PUBLIC_ERRORS = new Map([
  ['IMPORT_ABORTED', '导入已取消'],
  ['IMPORT_PATH_FORBIDDEN', '导入包包含不安全路径'],
  ['IMPORT_PATH_SYMLINK', '导入目标包含符号链接'],
  ['IMPORT_SHA256_MISMATCH', '导入包完整性校验失败'],
  ['IMPORT_VERIFY_FAILED', '导入结果校验失败'],
  ['IMPORT_ROLLBACK_FAILED', '导入失败且无法完整回滚，请检查工程资产'],
])

function publicError(cause) {
  const code = cause instanceof Error && PUBLIC_ERRORS.has(cause.code) ? cause.code : 'IMPORT_FAILED'
  return {
    code,
    message: PUBLIC_ERRORS.get(code) ?? 'Cocos 导入失败',
    rolledBack: cause instanceof Error && cause.rolledBack === true,
  }
}

export function createImportJobs({ runner, projectName, randomUUID: createId = randomUUID, maxJobs = 20 }) {
  const jobs = new Map()
  const requests = new Map()
  let closed = false

  return {
    async submit(request) {
      if (closed) throw new Error('IMPORT_SERVICE_CLOSED')
      const existing = requests.get(request.requestId)
      if (existing) {
        if (existing.sha256 !== request.sha256) throw new Error('IMPORT_REQUEST_ID_CONFLICT')
        return { jobId: existing.jobId }
      }

      for (const [jobId, job] of jobs) {
        if (jobs.size < maxJobs) break
        if (job.status === 'running') continue
        jobs.delete(jobId)
        requests.delete(job.requestId)
      }
      if (jobs.size >= maxJobs) throw new Error('IMPORT_QUEUE_FULL')

      const jobId = createId()
      const controller = new AbortController()
      const job = { jobId, requestId: request.requestId, status: 'running', phase: 'converting', controller }
      jobs.set(jobId, job)
      requests.set(request.requestId, { jobId, sha256: request.sha256 })

      void runner
        .run({
          ...request,
          signal: controller.signal,
          onPhase(phase) {
            if (job.status === 'running') job.phase = phase
          },
        })
        .then((result) => {
          if (job.status !== 'running') return
          if (controller.signal.aborted) {
            job.status = 'failed'
            job.error = { code: 'IMPORT_ABORTED', message: '导入已取消', rolledBack: false }
            return
          }
          job.status = 'completed'
          job.phase = 'verifying'
          job.result = { projectName: projectName(), ...result }
        })
        .catch((cause) => {
          if (job.status !== 'running') return
          job.status = 'failed'
          job.error = publicError(cause)
        })
      return { jobId }
    },

    async get(jobId) {
      const job = jobs.get(jobId)
      return job ? publicJob(job) : null
    },

    close() {
      closed = true
      for (const job of jobs.values()) {
        if (job.status !== 'running') continue
        job.controller.abort()
      }
    },
  }
}
