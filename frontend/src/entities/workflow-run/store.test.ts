import { describe, expect, it, vi } from 'vitest'

import { WORKFLOW_NODE_ORDER } from './constants'
import type { WorkflowRun, WorkflowNode } from './index'
import { createWorkflowRunStore } from './store'

function createNodes(): WorkflowNode[] {
  return WORKFLOW_NODE_ORDER.map((type, index) => {
    const common = {
      id: `run-1:${type}`,
      status: index === 0 ? ('active' as const) : ('locked' as const),
      taskId: null,
      submissionId: null,
      error: null,
    }
    if (type === 'character-setup') {
      return {
        ...common,
        type,
        input: { description: 'slime', referenceMedia: [] },
        output: null,
      }
    }
    if (type === 'character-template') {
      return { ...common, type, input: null, output: null }
    }
    return { ...common, type, input: null, output: null } as WorkflowNode
  })
}

function createRun(id = 'run-1'): WorkflowRun {
  return {
    id,
    projectId: 'project-1',
    characterId: null,
    outfitId: null,
    purpose: 'create_character',
    status: 'active',
    nodes: createNodes(),
    generationStatus: 'not_started',
    exportStatus: 'not_exported',
    prompt: 'Create a slime',
    createdAt: '2026-07-30T12:00:00.000Z',
  }
}

/** 后端响应包装：Response<T> { code, message, data: T } */
function wrapResponse<T>(data: T) {
  return { code: 0, message: 'ok', data }
}

/** 前端 WorkflowRun → 后端 nodes[0] 载荷。与 store._toNodePayload 保持一致。 */
function packNodes(run: WorkflowRun): Record<string, unknown> {
  return {
    projectId: run.projectId,
    characterId: run.characterId,
    outfitId: run.outfitId,
    purpose: run.purpose,
    status: run.status,
    nodes: run.nodes,
    generationStatus: run.generationStatus,
    exportStatus: run.exportStatus,
    prompt: run.prompt,
    createdAt: run.createdAt,
  }
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
      const node = body.nodes?.[0] ?? {}
      const runId = `run-${nextNumericId}`
      const run: WorkflowRun = {
        id: runId,
        // projectId 优先从 nodes 取（保留原始前端 string 值），回退到 project_id
        projectId:
          (node.projectId as string) ?? String(body.project_id ?? ''),
        characterId: node.characterId ?? null,
        outfitId: node.outfitId ?? null,
        purpose: node.purpose ?? 'create_character',
        status: node.status ?? 'active',
        nodes: node.nodes ?? [],
        generationStatus: node.generationStatus ?? 'not_started',
        exportStatus: node.exportStatus ?? 'not_exported',
        prompt: node.prompt ?? null,
        createdAt: node.createdAt ?? new Date().toISOString(),
      }
      runs.set(runId, run)
      return wrapResponse({
        id: nextNumericId++,
        project_id: body.project_id,
        nodes: [packNodes(run)],
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
          nodes: [packNodes(run)],
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
          nodes: [packNodes(run)],
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
        nodes: [packNodes(run)],
        status: 'active',
        version: 1,
      })
    }

    // PATCH /workflow-runs/{id} → update
    if (method === 'PATCH' && url.startsWith(`${BASE}/`)) {
      const numericId = url.split('/').pop()!
      const runId = `run-${numericId}`
      if (!runs.has(runId))
        throw Object.assign(new Error('Not Found'), { status: 404 })
      const body = JSON.parse((init?.body as string) ?? '{}')
      const node = body.nodes?.[0] ?? {}
      const existing = runs.get(runId)!
      const updated: WorkflowRun = {
        id: runId,
        projectId: String(body.project_id ?? existing.projectId),
        characterId:
          node.characterId !== undefined
            ? node.characterId
            : existing.characterId,
        outfitId:
          node.outfitId !== undefined ? node.outfitId : existing.outfitId,
        purpose: node.purpose ?? existing.purpose,
        status: node.status ?? existing.status,
        nodes: node.nodes ?? existing.nodes,
        generationStatus:
          node.generationStatus ?? existing.generationStatus,
        exportStatus: node.exportStatus ?? existing.exportStatus,
        prompt: node.prompt !== undefined ? node.prompt : existing.prompt,
        createdAt: node.createdAt ?? existing.createdAt,
      }
      runs.set(runId, updated)
      return wrapResponse({
        id: Number(numericId),
        project_id: Number(updated.projectId.split('-')[1] ?? updated.projectId),
        nodes: [packNodes(updated)],
        status: 'active',
        version: 1,
      })
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
      projectId: 'project-1',
      purpose: 'create_character',
      prompt: 'A fire dragon',
    })

    expect(run.id).toBeTruthy()
    expect(run.prompt).toBe('A fire dragon')
    expect(run.purpose).toBe('create_character')
    expect(api.fetch).toHaveBeenCalledWith(
      BASE,
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('gets a run by ID', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })
    const created = await store.create({
      projectId: 'project-1',
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
      projectId: 'project-1',
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
    await store.create({ projectId: 'project-1', purpose: 'create_character' })
    await store.create({
      projectId: 'project-1',
      purpose: 'create_character',
      prompt: '',
    })

    const runs = await store.list('project-1')

    expect(runs).toHaveLength(2)
    expect(runs[0]?.projectId).toBe('project-1')
    expect(runs[1]?.projectId).toBe('project-1')
  })

  it('saves a run and persists changes', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })
    const created = await store.create({
      projectId: 'project-1',
      purpose: 'create_character',
    })

    created.status = 'completed'
    await store.save(created)

    const reloaded = await store.get(created.id)
    expect(reloaded?.status).toBe('completed')
  })

  it('creates an add_action run with required character fields', async () => {
    const api = createMockApi()
    const store = createWorkflowRunStore({ api })

    const run = await store.create({
      projectId: 'project-1',
      purpose: 'add_action',
      characterId: 'char-1',
      outfitId: 'outfit-1',
      characterTemplateUrl: 'https://example.com/template.png',
      baseFrameUrls: ['https://example.com/frame1.png'],
    })

    expect(run.purpose).toBe('add_action')
    expect(run.characterId).toBe('char-1')
  })
})
