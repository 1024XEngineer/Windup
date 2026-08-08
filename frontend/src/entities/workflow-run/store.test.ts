import { describe, expect, it, vi } from 'vitest'

import type { WorkflowRun } from './index'
import { createWorkflowRunStore } from './store'

/** 后端响应包装：Response<T> { code, message, data: T } */
function wrapResponse<T>(data: T) {
  return { code: 0, message: 'ok', data }
}

/** 前端 WorkflowRun → 后端真实图节点，运行级字段附在首节点保留字段上。 */
function packNodes(run: WorkflowRun): Record<string, unknown>[] {
  const metadata = {
    characterId: run.characterId,
    outfitId: run.outfitId,
    purpose: run.purpose,
    status: run.status,
    generationStatus: run.generationStatus,
    exportStatus: run.exportStatus,
    prompt: run.prompt,
    createdAt: run.createdAt,
  }
  return run.nodes.map((node, index) =>
    index === 0 ? { ...node, __workflowRun: metadata } : { ...node },
  )
}

const BASE = '/workflow-runs'

function createMockApi() {
  // 后端内部使用前端 string ID 索引（保持简单）；
  // 响应时仍返回整数 ID，由被测 _fromBackend 转换回 string。
  const runs = new Map<string, WorkflowRun>()
  let nextNumericId = 1

  const fetch = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url
    const method = init?.method ?? 'GET'

    // POST /workflow-runs → create
    if (method === 'POST' && url === BASE) {
      const body = JSON.parse((init?.body as string) ?? '{}')
      const runId = `run-${nextNumericId}`
      const run: WorkflowRun = {
        id: runId,
        projectId: String(body.project_id ?? ''),
        characterId: null,
        outfitId: null,
        purpose: 'create_character',
        status: 'active',
        nodes: [],
        generationStatus: 'not_started',
        exportStatus: 'not_exported',
        prompt: null,
        createdAt: new Date().toISOString(),
      }
      runs.set(runId, run)
      return wrapResponse({
        id: nextNumericId++,
        project_id: body.project_id,
        nodes: packNodes(run),
        status: 'active',
        version: 1,
      })
    }

    // GET /workflow-runs → list all (getByCharacter 回退)
    if (method === 'GET' && url === BASE) {
      return wrapResponse(
        [...runs.entries()].map(([rid, run]) => ({
          id: Number(rid.split('-')[1] ?? rid),
          project_id: Number(run.projectId.split('-')[1] ?? run.projectId),
          nodes: packNodes(run),
          status: 'active',
          version: 1,
        })),
      )
    }

    // GET /workflow-runs?project_id=X → list by project
    // GET /workflow-runs?characterId=X → list by character
    if (method === 'GET' && url.startsWith(`${BASE}?`)) {
      const params = new URLSearchParams(url.split('?')[1])
      const characterId = params.get('characterId')
      const projectId = params.get('project_id')
      const all = [...runs.entries()]
        .filter(([, r]) => {
          if (characterId) return r.characterId === characterId
          if (projectId) return r.projectId === projectId
          return true
        })
        .map(([rid, run]) => ({
          id: Number(rid.split('-')[1] ?? rid),
          project_id: Number(run.projectId.split('-')[1] ?? run.projectId),
          nodes: packNodes(run),
          status: 'active',
          version: 1,
        }))
      return wrapResponse(all)
    }

    // GET /workflow-runs/{id} → get by ID
    if (method === 'GET' && url.startsWith(`${BASE}/`)) {
      const numericId = url.split('/').pop()!
      const runId = `run-${numericId}`
      const run = runs.get(runId)
      if (!run) throw Object.assign(new Error('Not Found'), { status: 404 })
      return wrapResponse({
        id: Number(numericId),
        project_id: Number(run.projectId.split('-')[1] ?? run.projectId),
        nodes: packNodes(run),
        status: 'active',
        version: 1,
      })
    }

    // PATCH /workflow-runs/{id} → update
    if (method === 'PATCH' && url.startsWith(`${BASE}/`)) {
      const numericId = url.split('/').pop()!
      const runId = `run-${numericId}`
      if (!runs.has(runId)) throw Object.assign(new Error('Not Found'), { status: 404 })
      const body = JSON.parse((init?.body as string) ?? '{}')
      const storedNodes = (body.nodes ?? []) as Record<string, unknown>[]
      const metadata = (storedNodes[0]?.__workflowRun ?? {}) as Record<string, unknown>
      const graphNodes = storedNodes.map(({ __workflowRun: _metadata, ...node }) => node)
      const existing = runs.get(runId)!
      const updated: WorkflowRun = {
        id: runId,
        projectId: String(body.project_id ?? existing.projectId),
        characterId:
          metadata.characterId !== undefined
            ? (metadata.characterId as string | null)
            : existing.characterId,
        outfitId:
          metadata.outfitId !== undefined
            ? (metadata.outfitId as string | null)
            : existing.outfitId,
        purpose: (metadata.purpose as WorkflowRun['purpose']) ?? existing.purpose,
        status: (metadata.status as WorkflowRun['status']) ?? existing.status,
        nodes: graphNodes as unknown as WorkflowRun['nodes'],
        generationStatus:
          (metadata.generationStatus as WorkflowRun['generationStatus']) ??
          existing.generationStatus,
        exportStatus:
          (metadata.exportStatus as WorkflowRun['exportStatus']) ?? existing.exportStatus,
        prompt:
          metadata.prompt !== undefined ? (metadata.prompt as string | null) : existing.prompt,
        createdAt: (metadata.createdAt as string) ?? existing.createdAt,
      }
      runs.set(runId, updated)
      return wrapResponse({
        id: Number(numericId),
        project_id: Number(updated.projectId.split('-')[1] ?? updated.projectId),
        nodes: packNodes(updated),
        status: 'active',
        version: 1,
      })
    }

    // DELETE /workflow-runs/{id} → soft delete（测试存储直接移除）
    if (method === 'DELETE' && url.startsWith(`${BASE}/`)) {
      const numericId = url.split('/').pop()!
      const removed = runs.delete(`run-${numericId}`)
      if (!removed) throw Object.assign(new Error('Not Found'), { status: 404 })
      return wrapResponse(null)
    }

    throw Object.assign(new Error('Not Found'), { status: 404 })
  })

  return { runs, fetch }
}

describe('createWorkflowRunStore', () => {
  it('creates a run and returns the server-persisted snapshot', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })

    const run = await store.create({
      projectId: '1',
      purpose: 'create_character',
      prompt: 'A fire dragon',
    })

    expect(run.id).toBeTruthy()
    expect(run.prompt).toBe('A fire dragon')
    expect(run.purpose).toBe('create_character')
    expect(api.fetch).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: 'POST' }))
  })

  it('gets a run by ID', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })
    const created = await store.create({
      projectId: '1',
      purpose: 'create_character',
    })

    const found = await store.get(created.id)

    expect(found?.id).toBe(created.id)
  })

  it('returns null when getting a non-existent run', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })

    const result = await store.get('999')

    expect(result).toBeNull()
  })

  it('does not disguise a server failure as a missing run', async () => {
    const failure = Object.assign(new Error('Service Unavailable'), {
      status: 503,
    })
    const store = createWorkflowRunStore({
      api: { fetch: vi.fn().mockRejectedValue(failure) },
    })

    await expect(store.get('run-1')).rejects.toBe(failure)
    await expect(store.getByCharacter('character-1')).rejects.toBe(failure)
  })

  it('finds the run bound to a character', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })
    const created = await store.create({
      projectId: '1',
      purpose: 'create_character',
    })
    created.characterId = 'character-1'
    await store.save(created)

    const found = await store.getByCharacter('character-1')

    expect(found?.id).toBe(created.id)
    expect(found?.characterId).toBe('character-1')
  })

  it('returns null when no run is bound to a character', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })

    const result = await store.getByCharacter('missing')

    expect(result).toBeNull()
  })

  it('lists runs by project', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })
    await store.create({ projectId: '1', purpose: 'create_character' })
    await store.create({
      projectId: '1',
      purpose: 'create_character',
      prompt: '',
    })

    const runs = await store.list('1')

    expect(runs).toHaveLength(2)
    expect(runs[0]?.projectId).toBe('1')
    expect(runs[1]?.projectId).toBe('1')
  })

  it('saves a run and persists changes', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })
    const created = await store.create({
      projectId: '1',
      purpose: 'create_character',
    })

    created.status = 'completed'
    await store.save(created)

    const reloaded = await store.get(created.id)
    expect(reloaded?.status).toBe('completed')
  })

  it('removes a run through the persistence contract', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })
    const created = await store.create({ projectId: '1', purpose: 'create_character' })

    await store.remove(created.id)

    await expect(store.get(created.id)).resolves.toBeNull()
    expect(api.fetch).toHaveBeenCalledWith(`/workflow-runs/${created.id}`, {
      method: 'DELETE',
    })
  })

  it('removes an in-memory run instead of letting it reappear after navigation', async () => {
    const store = createWorkflowRunStore()
    const created = await store.create({ projectId: '1', purpose: 'create_character' })

    await store.remove(created.id)

    await expect(store.get(created.id)).resolves.toBeNull()
  })

  it('persists real graph nodes directly instead of wrapping them in a synthetic root node', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })
    const created = await store.create({
      projectId: '1',
      purpose: 'create_character',
      prompt: '像素骑士',
    })
    created.nodes = [
      {
        id: `${created.id}:character-setup`,
        type: 'character-setup',
        status: 'active',
        dependsOnNodeIds: [],
        taskId: null,
        submissionId: null,
        error: null,
        input: { description: '像素骑士', referenceMedia: [] },
        output: null,
      },
    ]

    await store.save(created)

    const patchCall = api.fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')
    const body = JSON.parse(String(patchCall?.[1]?.body)) as { nodes: Record<string, unknown>[] }
    expect(body.nodes[0]?.type).toBe('character-setup')
    expect(body.nodes[0]).not.toHaveProperty('nodes')
    await expect(store.get(created.id)).resolves.toMatchObject({ nodes: created.nodes })
  })

  it('creates an add_action run with required character fields', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })

    const run = await store.create({
      projectId: '1',
      purpose: 'add_action',
      characterId: 'char-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'https://example.com/template.png',
      baseFrameUrls: ['https://example.com/frame1.png'],
    })

    expect(run.purpose).toBe('add_action')
    expect(run.characterId).toBe('char-1')
  })

  it('rejects an incomplete persisted node before it reaches page code', async () => {
    const api = {
      fetch: vi.fn(async () =>
        wrapResponse({
          id: 1,
          project_id: 1,
          nodes: [{ id: 'broken', type: 'action-full-frame' }],
          status: 'active',
          version: 1,
        }),
      ),
    }
    const store = createWorkflowRunStore({ api })

    await expect(store.get('1')).rejects.toThrow('WorkflowRun 节点数据无效')
  })
})
