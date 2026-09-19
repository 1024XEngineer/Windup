import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createImportJobs } from '../source/import-jobs.js'
import { PROTOCOL } from '../source/protocol.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve))
}

test('import jobs expose live phases and a completed protocol result', async () => {
  const run = deferred()
  let request
  const jobs = createImportJobs({
    runner: {
      run(value) {
        request = value
        return run.promise
      },
    },
    projectName: () => 'Game',
    randomUUID: () => 'job-1',
  })

  assert.deepEqual(await jobs.submit({ requestId: 'request-1', zipBytes: new Uint8Array([1]), sha256: 'abc' }), {
    jobId: 'job-1',
  })
  request.onPhase('writing')
  assert.deepEqual(await jobs.get('job-1'), {
    protocol: PROTOCOL,
    jobId: 'job-1',
    status: 'running',
    phase: 'writing',
  })

  run.resolve({ dbUrl: 'db://assets/p.prefab', animationCount: 2, frameCount: 64 })
  await nextTurn()
  assert.deepEqual(await jobs.get('job-1'), {
    protocol: PROTOCOL,
    jobId: 'job-1',
    status: 'completed',
    phase: 'verifying',
    result: {
      projectName: 'Game',
      dbUrl: 'db://assets/p.prefab',
      animationCount: 2,
      frameCount: 64,
    },
  })
})

test('import jobs reuse a job and expose a safe runner-provided failure', async () => {
  const run = deferred()
  const jobs = createImportJobs({
    runner: {
      run(request) {
        request.onPhase('verifying')
        return run.promise
      },
    },
    projectName: () => 'Game',
    randomUUID: () => 'job-1',
  })
  const submitted = await jobs.submit({ requestId: 'request-1', zipBytes: new Uint8Array(), sha256: 'abc' })
  assert.deepEqual(await jobs.submit({ requestId: 'request-1', zipBytes: new Uint8Array(), sha256: 'abc' }), submitted)

  const failure = new Error('internal detail must not leak')
  failure.code = 'IMPORT_VERIFY_FAILED'
  failure.rolledBack = true
  run.reject(failure)
  await nextTurn()
  assert.deepEqual(await jobs.get('job-1'), {
    protocol: PROTOCOL,
    jobId: 'job-1',
    status: 'failed',
    phase: 'verifying',
    error: { code: 'IMPORT_VERIFY_FAILED', message: '导入结果校验失败', rolledBack: true },
  })
  assert.equal(await jobs.get('missing'), null)
})

test('import jobs redact arbitrary filesystem errors', async () => {
  const jobs = createImportJobs({
    runner: { run: async () => { throw new Error('ENOENT: C:\\Users\\private\\secret.png') } },
    projectName: () => 'Game',
    randomUUID: () => 'job-1',
  })
  await jobs.submit({ requestId: 'request-1', zipBytes: new Uint8Array(), sha256: 'abc' })
  await nextTurn()
  const job = await jobs.get('job-1')
  assert.deepEqual(job.error, { code: 'IMPORT_FAILED', message: 'Cocos 导入失败', rolledBack: false })
  assert.equal(JSON.stringify(job).includes('C:\\Users'), false)
})

test('import jobs evict completed history at the configured bound', async () => {
  let nextId = 0
  const jobs = createImportJobs({
    runner: { run: async () => ({ dbUrl: 'db://assets/p.prefab', animationCount: 1, frameCount: 1 }) },
    projectName: () => 'Game',
    randomUUID: () => `job-${++nextId}`,
    maxJobs: 2,
  })
  for (let index = 1; index <= 3; index += 1) {
    await jobs.submit({ requestId: `request-${index}`, zipBytes: new Uint8Array(), sha256: `${index}` })
    await nextTurn()
  }
  assert.equal(await jobs.get('job-1'), null)
  assert.equal((await jobs.get('job-3')).status, 'completed')
})

test('import jobs reject a new request when every bounded slot is running', async () => {
  const run = deferred()
  const jobs = createImportJobs({
    runner: { run: () => run.promise },
    projectName: () => 'Game',
    randomUUID: () => 'job-1',
    maxJobs: 1,
  })
  await jobs.submit({ requestId: 'request-1', zipBytes: new Uint8Array(), sha256: 'abc' })
  await assert.rejects(
    () => jobs.submit({ requestId: 'request-2', zipBytes: new Uint8Array(), sha256: 'def' }),
    /IMPORT_QUEUE_FULL/,
  )
  run.resolve({ dbUrl: 'db://assets/p.prefab', animationCount: 1, frameCount: 1 })
})

test('closing jobs aborts running imports and rejects later submissions', async () => {
  const run = deferred()
  let signal
  const jobs = createImportJobs({
    runner: {
      run(request) {
        signal = request.signal
        return run.promise
      },
    },
    projectName: () => 'Game',
    randomUUID: () => 'job-1',
  })
  await jobs.submit({ requestId: 'request-1', zipBytes: new Uint8Array(), sha256: 'abc' })
  jobs.close()
  assert.equal(signal.aborted, true)
  await assert.rejects(
    () => jobs.submit({ requestId: 'request-2', zipBytes: new Uint8Array(), sha256: 'def' }),
    /IMPORT_SERVICE_CLOSED/,
  )
  const aborted = new Error('internal abort detail')
  aborted.code = 'IMPORT_ABORTED'
  aborted.rolledBack = true
  run.reject(aborted)
  await nextTurn()
  assert.deepEqual((await jobs.get('job-1')).error, {
    code: 'IMPORT_ABORTED',
    message: '导入已取消',
    rolledBack: true,
  })
})
