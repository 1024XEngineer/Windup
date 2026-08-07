import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from './index'

const nodes: WorkflowNode[] = [
  {
    id: 'character-node',
    type: 'character',
    status: 'passed',
    phase: 'completed',
    dependsOnNodeIds: [],
    generations: [{ taskId: '91', role: 'character_candidates' }],
    error: null,
    input: { prompt: '一个像素骑士', referenceMedia: [] },
    selectedImageUrl: 'https://cdn.windup.test/character.png',
  },
  {
    id: 'walk-node',
    type: 'action',
    status: 'active',
    phase: 'generating_animation',
    dependsOnNodeIds: ['character-node'],
    generations: [{ taskId: '92', role: 'animation' }],
    error: null,
    input: { outfitId: 'outfit-1', name: '行走', type: 'walk', prompt: null, fps: 12 },
    selectedFirstFrameUrl: 'https://cdn.windup.test/walk-first.png',
  },
  {
    id: 'jump-node',
    type: 'action',
    status: 'active',
    phase: 'generating_animation',
    dependsOnNodeIds: ['character-node'],
    generations: [{ taskId: '93', role: 'animation' }],
    error: null,
    input: { outfitId: 'outfit-1', name: '跳跃', type: 'jump', prompt: null, fps: 12 },
    selectedFirstFrameUrl: 'https://cdn.windup.test/jump-first.png',
  },
]

const workflowRunDto = {
  id: 17,
  project_id: 42,
  nodes,
  status: 'active',
  version: 3,
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadWorkflowRunApis(fetchFn: typeof fetch) {
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.windup.test')
  vi.stubGlobal('fetch', fetchFn)
  return (await import('./api')).workflowRunApis
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ code: 200, message: 'success', data }), {
    headers: { 'content-type': 'application/json' },
  })
}

describe('workflowRunApis', () => {
  it('persists frontend nodes directly without a synthetic root node', async () => {
    let request: Request | undefined
    const apis = await loadWorkflowRunApis(async (input, init) => {
      request = new Request(input, init)
      return jsonResponse(workflowRunDto)
    })

    await expect(apis.create({ projectId: '42', nodes })).resolves.toEqual({
      id: '17',
      projectId: '42',
      version: 3,
      storageStatus: 'active',
      nodes,
    })
    expect(request?.url).toBe('https://api.windup.test/workflow-runs')
    expect(request?.method).toBe('POST')
    await expect(request?.json()).resolves.toEqual({ project_id: 42, nodes })
  })

  it('gets a run through the backend resource path', async () => {
    let requestUrl = ''
    const apis = await loadWorkflowRunApis(async (input) => {
      requestUrl = String(input)
      return jsonResponse(workflowRunDto)
    })
    await apis.get('17')
    expect(requestUrl).toBe('https://api.windup.test/workflow-runs/17')
  })

  it('patches the complete node graph and uses the returned version', async () => {
    let request: Request | undefined
    const apis = await loadWorkflowRunApis(async (input, init) => {
      request = new Request(input, init)
      return jsonResponse({ ...workflowRunDto, version: 4 })
    })
    const updated = await apis.update({
      id: '17',
      projectId: '42',
      version: 3,
      storageStatus: 'active',
      nodes,
    })
    expect(request?.method).toBe('PATCH')
    await expect(request?.json()).resolves.toEqual({ nodes, status: 'active' })
    expect(updated.version).toBe(4)
  })

  it('soft deletes through the backend DELETE endpoint', async () => {
    let request: Request | undefined
    const apis = await loadWorkflowRunApis(async (input, init) => {
      request = new Request(input, init)
      return jsonResponse(null)
    })
    await expect(apis.remove('17')).resolves.toBeUndefined()
    expect(request?.url).toBe('https://api.windup.test/workflow-runs/17')
    expect(request?.method).toBe('DELETE')
  })

  it('rejects a node without an explicit dependency list', async () => {
    const [{ dependsOnNodeIds: _omitted, ...invalidNode }, ...rest] = nodes
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({ ...workflowRunDto, nodes: [invalidNode, ...rest] }),
    )
    await expect(apis.get('17')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('rejects a dependency that points outside the persisted graph', async () => {
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({
        ...workflowRunDto,
        nodes: nodes.map((node) =>
          node.id === 'walk-node' ? { ...node, dependsOnNodeIds: ['missing-node'] } : node,
        ),
      }),
    )
    await expect(apis.get('17')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('rejects a cyclic node graph', async () => {
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({
        ...workflowRunDto,
        nodes: nodes.map((node) =>
          node.id === 'character-node' ? { ...node, dependsOnNodeIds: ['walk-node'] } : node,
        ),
      }),
    )
    await expect(apis.get('17')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('accepts an action-only graph for adding an action to an existing character', async () => {
    const actionOnlyDto = {
      ...workflowRunDto,
      nodes: [{ ...nodes[1], dependsOnNodeIds: [] }],
    }
    const apis = await loadWorkflowRunApis(async () => jsonResponse(actionOnlyDto))
    await expect(apis.get('17')).resolves.toMatchObject({ nodes: actionOnlyDto.nodes })
  })

  it('rejects completed nodes that lost their selected asset', async () => {
    const completedActionWithoutSelection = {
      ...nodes[1],
      status: 'passed' as const,
      phase: 'completed' as const,
      selectedFirstFrameUrl: null,
    }
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({ ...workflowRunDto, nodes: [nodes[0], completedActionWithoutSelection] }),
    )
    await expect(apis.get('17')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('rejects a completed character node that lost its selected image', async () => {
    const completedCharacterWithoutSelection = {
      ...nodes[0],
      selectedImageUrl: null,
    }
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({ ...workflowRunDto, nodes: [completedCharacterWithoutSelection] }),
    )
    await expect(apis.get('17')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })
})
