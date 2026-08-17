import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from './index'

const nodes: WorkflowNode[] = [
  {
    id: 'setup-node',
    type: 'character-setup',
    status: 'passed',
    phase: 'completed',
    dependsOnNodeIds: [],
    generations: [],
    error: null,
    input: { prompt: '一个像素骑士', referenceMedia: [] },
  },
  {
    id: 'template-node',
    type: 'character-template',
    status: 'passed',
    phase: 'completed',
    dependsOnNodeIds: ['setup-node'],
    generations: [{ taskId: '91', role: 'character_template' }],
    error: null,
    selectedImageUrl: 'https://cdn.windup.test/character.png',
  },
  {
    id: 'walk-first-frame',
    type: 'action-first-frame',
    status: 'passed',
    phase: 'completed',
    dependsOnNodeIds: ['template-node'],
    generations: [{ taskId: '92', role: 'first_frame' }],
    error: null,
    input: { outfitId: 'outfit-1', name: '行走', type: 'walk', prompt: null, fps: 12 },
    selectedFirstFrameUrl: 'https://cdn.windup.test/walk-first.png',
  },
  {
    id: 'walk-generation-method',
    type: 'action-generation-method',
    status: 'passed',
    phase: 'completed',
    dependsOnNodeIds: ['walk-first-frame'],
    generations: [],
    error: null,
    method: 'video-cropping',
  },
  {
    id: 'walk-full-frame',
    type: 'action-full-frame',
    status: 'active',
    phase: 'generating',
    dependsOnNodeIds: ['walk-generation-method'],
    generations: [{ taskId: '93', role: 'complete_animation' }],
    error: null,
  },
  {
    id: 'walk-review',
    type: 'review',
    status: 'locked',
    phase: 'reviewing',
    dependsOnNodeIds: ['walk-full-frame'],
    generations: [],
    error: null,
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
  it('hydrates the six visible workflow nodes with explicit dependency edges', async () => {
    const sixNodeDto = {
      ...workflowRunDto,
      nodes: [
        {
          id: 'setup-1',
          type: 'character-setup',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: [],
          generations: [],
          error: null,
          input: { prompt: 'pixel knight', referenceMedia: [] },
        },
        {
          id: 'template-1',
          type: 'character-template',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['setup-1'],
          generations: [{ taskId: 'task-template', role: 'character_template' }],
          error: null,
          selectedImageUrl: 'https://img/knight.png',
        },
        {
          id: 'first-frame-1',
          type: 'action-first-frame',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['template-1'],
          generations: [{ taskId: 'task-frame', role: 'first_frame' }],
          error: null,
          input: { outfitId: 'outfit-1', name: 'walk', type: 'walk', prompt: null, fps: 12 },
          selectedFirstFrameUrl: 'https://img/walk-first.png',
        },
        {
          id: 'generation-method-1',
          type: 'action-generation-method',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['first-frame-1'],
          generations: [],
          error: null,
          method: 'video-cropping',
        },
        {
          id: 'full-frame-1',
          type: 'action-full-frame',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['generation-method-1'],
          generations: [{ taskId: 'task-animation', role: 'complete_animation' }],
          error: null,
        },
        {
          id: 'review-1',
          type: 'review',
          status: 'active',
          phase: 'reviewing',
          dependsOnNodeIds: ['full-frame-1'],
          generations: [],
          error: null,
        },
      ],
    }
    const apis = await loadWorkflowRunApis(async () => jsonResponse(sixNodeDto))

    await expect(apis.get('17')).resolves.toMatchObject({
      nodes: [
        { type: 'character-setup', dependsOnNodeIds: [] },
        { type: 'character-template', dependsOnNodeIds: ['setup-1'] },
        { type: 'action-first-frame', dependsOnNodeIds: ['template-1'] },
        { type: 'action-generation-method', dependsOnNodeIds: ['first-frame-1'] },
        { type: 'action-full-frame', dependsOnNodeIds: ['generation-method-1'] },
        { type: 'review', dependsOnNodeIds: ['full-frame-1'] },
      ],
    })
  })

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
    await expect(request?.json()).resolves.toEqual({ nodes, status: 'active', version: 3 })
    expect(updated.version).toBe(4)
  })

  it('exposes a version conflict as a workflow-run domain error', async () => {
    const apis = await loadWorkflowRunApis(
      async () =>
        new Response(
          JSON.stringify({ code: 409, message: '执行记录版本冲突，请刷新后重试', data: null }),
          { headers: { 'content-type': 'application/json' } },
        ),
    )

    await expect(
      apis.update({
        id: '17',
        projectId: '42',
        version: 3,
        storageStatus: 'active',
        nodes,
      }),
    ).rejects.toMatchObject({
      name: 'WorkflowRunConflictError',
      message: '执行记录版本冲突，请刷新后重试',
    })
  })

  it('preserves non-conflict API errors from an update', async () => {
    const apis = await loadWorkflowRunApis(
      async () =>
        new Response(JSON.stringify({ code: 500, message: '保存失败', data: null }), {
          headers: { 'content-type': 'application/json' },
        }),
    )

    await expect(
      apis.update({
        id: '17',
        projectId: '42',
        version: 3,
        storageStatus: 'active',
        nodes,
      }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 500, message: '保存失败' })
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

  it('拒绝超过 20 个字符的角色名称', async () => {
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({
        ...workflowRunDto,
        nodes: nodes.map((node) =>
          node.type === 'character-setup'
            ? { ...node, input: { ...node.input, name: 'x'.repeat(21) } }
            : node,
        ),
      }),
    )

    await expect(apis.get('17')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('rejects an empty deletion marker instead of treating it as archived history', async () => {
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({
        ...workflowRunDto,
        nodes: nodes.map((node) =>
          node.id === 'walk-full-frame' ? { ...node, deletedAt: '' } : node,
        ),
      }),
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
          node.id === 'walk-full-frame' ? { ...node, dependsOnNodeIds: ['missing-node'] } : node,
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
          node.id === 'setup-node' ? { ...node, dependsOnNodeIds: ['walk-review'] } : node,
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
      nodes: [{ ...nodes[2], dependsOnNodeIds: [] }],
    }
    const apis = await loadWorkflowRunApis(async () => jsonResponse(actionOnlyDto))
    await expect(apis.get('17')).resolves.toMatchObject({ nodes: actionOnlyDto.nodes })
  })

  it('rejects completed nodes that lost their selected asset', async () => {
    const completedActionWithoutSelection = {
      ...nodes[2],
      status: 'passed' as const,
      phase: 'completed' as const,
      selectedFirstFrameUrl: null,
    }
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({ ...workflowRunDto, nodes: [completedActionWithoutSelection] }),
    )
    await expect(apis.get('17')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('rejects a completed character node that lost its selected image', async () => {
    const completedCharacterWithoutSelection = {
      ...nodes[1],
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

  it('rejects a passed node whose phase is not completed', async () => {
    const passedCharacterStillConfiguring = {
      ...nodes[0],
      status: 'passed' as const,
      phase: 'configuring' as const,
    }
    const apis = await loadWorkflowRunApis(async () =>
      jsonResponse({ ...workflowRunDto, nodes: [passedCharacterStillConfiguring] }),
    )

    await expect(apis.get('17')).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-response',
    })
  })

  it('lists project runs and preserves the character binding', async () => {
    let requestUrl = ''
    const setupNode = nodes[0]
    if (setupNode?.type !== 'character-setup') throw new Error('test fixture is invalid')
    const listedRun = {
      ...workflowRunDto,
      nodes: [
        {
          ...setupNode,
          input: { ...setupNode.input, characterId: 'character-7' },
        },
      ],
    }
    const apis = await loadWorkflowRunApis(async (input) => {
      requestUrl = String(input)
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: [listedRun],
          total: 1,
          page: 2,
          page_size: 10,
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })

    await expect(apis.listByProject('42', { page: 2, pageSize: 10 })).resolves.toMatchObject({
      items: [
        {
          id: '17',
          nodes: [
            {
              type: 'character-setup',
              input: { characterId: 'character-7' },
            },
          ],
        },
      ],
      total: 1,
      page: 2,
      pageSize: 10,
    })
    expect(requestUrl).toBe(
      'https://api.windup.test/workflow-runs?project_id=42&page=2&page_size=10',
    )
  })
})
