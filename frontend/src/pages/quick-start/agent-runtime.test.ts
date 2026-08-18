import { describe, expect, it, vi } from 'vitest'

import type { MediaReference, WorkflowRun } from '@/entities'
import {
  getQuickStartWorkflowContext,
  runQuickStartAgentTurn,
  type AgentTransport,
  type AgentTransportEvent,
  type QuickStartAgentRuntimeEvent,
} from './agent-runtime'

function workflow(): WorkflowRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    version: 4,
    storageStatus: 'active',
    nodes: [
      {
        id: 'character-setup',
        type: 'character-setup',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: [],
        generations: [],
        error: null,
        input: {
          characterId: 'character-1',
          prompt: '戴星形单片眼镜的像素裁缝',
          referenceMedia: ['https://example.test/private-reference.png' as MediaReference],
        },
      },
      {
        id: 'character-template',
        type: 'character-template',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['character-setup'],
        generations: [{ taskId: 'template-task', role: 'character_template' }],
        error: null,
        selectedImageUrl: 'https://example.test/template.png',
      },
      {
        id: 'action-first',
        type: 'action-first-frame',
        status: 'active',
        phase: 'selecting',
        dependsOnNodeIds: ['character-template'],
        generations: [{ taskId: 'first-task', role: 'first_frame' }],
        error: null,
        input: {
          outfitId: 'outfit-1',
          name: '挥手',
          type: 'custom',
          prompt: '慢慢挥手',
          fps: 12,
        },
        selectedFirstFrameUrl: null,
      },
      {
        id: 'deleted-action',
        type: 'action-first-frame',
        status: 'passed',
        phase: 'completed',
        dependsOnNodeIds: ['character-template'],
        generations: [],
        error: null,
        deletedAt: '2026-08-18T10:00:00Z',
        input: {
          outfitId: 'outfit-1',
          name: '旧动作',
          type: 'custom',
          prompt: '旧动作',
          fps: 12,
        },
        selectedFirstFrameUrl: 'https://example.test/deleted.png',
      },
    ],
  }
}

async function* events(...items: AgentTransportEvent[]): AsyncIterable<AgentTransportEvent> {
  yield* items
}

describe('Quick Start agent runtime', () => {
  it('projects the WorkflowRun into a small read-only context', () => {
    const context = getQuickStartWorkflowContext(workflow())

    expect(context).toEqual({
      runId: 'run-1',
      projectId: 'project-1',
      version: 4,
      characterPrompt: '戴星形单片眼镜的像素裁缝',
      currentNode: {
        id: 'action-first',
        type: 'action-first-frame',
        status: 'active',
        phase: 'selecting',
        error: null,
      },
      nodes: [
        {
          id: 'character-setup',
          type: 'character-setup',
          status: 'passed',
          phase: 'completed',
          error: null,
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'passed',
          phase: 'completed',
          error: null,
        },
        {
          id: 'action-first',
          type: 'action-first-frame',
          status: 'active',
          phase: 'selecting',
          error: null,
        },
      ],
    })
    expect(JSON.stringify(context)).not.toContain('template-task')
    expect(JSON.stringify(context)).not.toContain('private-reference.png')
    expect(JSON.stringify(context)).not.toContain('deleted-action')
  })

  it('executes get_workflow_context and sends its tool result back before completing', async () => {
    const stream = vi
      .fn<AgentTransport['stream']>()
      .mockImplementationOnce(() =>
        events(
          { type: 'text', text: '我先看看当前进度。' },
          {
            type: 'function-call',
            callId: 'call-1',
            name: 'get_workflow_context',
            arguments: {},
          },
          { type: 'completed' },
        ),
      )
      .mockImplementationOnce(() =>
        events({ type: 'text', text: '现在正在选择挥手动作的首帧。' }, { type: 'completed' }),
      )
    const transport: AgentTransport = { stream }
    const observed: QuickStartAgentRuntimeEvent[] = []

    const result = await runQuickStartAgentTurn({
      transport,
      history: [],
      input: '现在做到哪一步了？',
      getWorkflow: workflow,
      onEvent: (event) => observed.push(event),
    })

    expect(stream).toHaveBeenCalledTimes(2)
    expect(stream.mock.calls[0]?.[0].instructions).toContain(
      '不要声称已经创建、重生成、微调、回退或保存',
    )
    expect(stream.mock.calls[0]?.[0].tools).toEqual([
      expect.objectContaining({ name: 'get_workflow_context' }),
    ])
    expect(stream.mock.calls[1]?.[0].messages.at(-1)).toEqual({
      role: 'tool',
      callId: 'call-1',
      name: 'get_workflow_context',
      content: JSON.stringify(getQuickStartWorkflowContext(workflow())),
    })
    expect(observed.map((event) => event.type)).toEqual([
      'text',
      'function-call',
      'tool-result',
      'text',
      'completed',
    ])
    expect(result.assistantText).toBe('我先看看当前进度。现在正在选择挥手动作的首帧。')
    expect(result.history.at(-1)).toEqual({
      role: 'assistant',
      content: '现在正在选择挥手动作的首帧。',
    })
  })

  it('fails closed when one user turn attempts a second function call', async () => {
    const transport: AgentTransport = {
      stream: vi
        .fn<AgentTransport['stream']>()
        .mockImplementationOnce(() =>
          events(
            {
              type: 'function-call',
              callId: 'call-1',
              name: 'get_workflow_context',
              arguments: {},
            },
            { type: 'completed' },
          ),
        )
        .mockImplementationOnce(() =>
          events({
            type: 'function-call',
            callId: 'call-2',
            name: 'get_workflow_context',
            arguments: {},
          }),
        ),
    }
    const observed: QuickStartAgentRuntimeEvent[] = []

    await expect(
      runQuickStartAgentTurn({
        transport,
        history: [],
        input: '再读一次',
        getWorkflow: workflow,
        onEvent: (event) => observed.push(event),
      }),
    ).rejects.toThrow('每轮最多调用一次 function')
    expect(observed.at(-1)).toMatchObject({ type: 'failed' })
  })

  it('does not execute unknown functions', async () => {
    const transport: AgentTransport = {
      stream: () =>
        events({ type: 'function-call', callId: 'call-1', name: 'regenerate', arguments: {} }),
    }

    await expect(
      runQuickStartAgentTurn({
        transport,
        history: [],
        input: '重新生成',
        getWorkflow: workflow,
      }),
    ).rejects.toThrow('不支持 function：regenerate')
  })

  it('surfaces transport failures as a failed runtime event', async () => {
    const transport: AgentTransport = {
      stream: () => events({ type: 'failed', error: '模型暂时不可用' }),
    }
    const observed: QuickStartAgentRuntimeEvent[] = []

    await expect(
      runQuickStartAgentTurn({
        transport,
        history: [],
        input: '你好',
        getWorkflow: workflow,
        onEvent: (event) => observed.push(event),
      }),
    ).rejects.toThrow('模型暂时不可用')
    expect(observed).toEqual([{ type: 'failed', error: '模型暂时不可用' }])
  })

  it('treats completed as the hard end of one transport stream', async () => {
    const getWorkflow = vi.fn(workflow)
    const stream = vi.fn<AgentTransport['stream']>(() =>
      events(
        { type: 'text', text: '回答结束。' },
        { type: 'completed' },
        { type: 'text', text: '不应出现' },
        {
          type: 'function-call',
          callId: 'late-call',
          name: 'get_workflow_context',
          arguments: {},
        },
      ),
    )

    const result = await runQuickStartAgentTurn({
      transport: { stream },
      history: [],
      input: '回答我',
      getWorkflow,
    })

    expect(result.assistantText).toBe('回答结束。')
    expect(stream).toHaveBeenCalledTimes(1)
    expect(getWorkflow).not.toHaveBeenCalled()
  })
})
