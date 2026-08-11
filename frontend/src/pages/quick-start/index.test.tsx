import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QuickStartService } from './service'
import type { WorkflowRun } from '@/entities'
import { QuickStartPage } from './index'

afterEach(cleanup)

describe('QuickStartPage', () => {
  it('keeps the natural-language creation entry visible when no run is selected', () => {
    render(
      <MemoryRouter>
        <QuickStartPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /用一句角色设定/u })).toBeTruthy()
  })

  it('shows first-frame confirmation instead of stale character candidates after a template is confirmed', async () => {
    const run: WorkflowRun = {
      id: 'run-1',
      projectId: 'project-1',
      version: 1,
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
          input: { characterId: 'character-1', prompt: '像素骑士', referenceMedia: [] },
        },
        {
          id: 'character-template',
          type: 'character-template',
          status: 'passed',
          phase: 'completed',
          dependsOnNodeIds: ['character-setup'],
          generations: [{ taskId: 'task-template', role: 'character_template' }],
          error: null,
          selectedImageUrl: 'https://example.test/template.png',
        },
        {
          id: 'action-walk',
          type: 'action-first-frame',
          status: 'active',
          phase: 'selecting',
          dependsOnNodeIds: ['character-template'],
          generations: [{ taskId: 'task-first-frame', role: 'first_frame' }],
          error: null,
          input: {
            outfitId: 'outfit-1',
            name: '行走',
            type: 'custom',
            prompt: '向右行走',
            fps: 12,
          },
          selectedFirstFrameUrl: null,
        },
        {
          id: 'action-walk:action-generation-method',
          type: 'action-generation-method',
          status: 'locked',
          phase: 'selecting',
          dependsOnNodeIds: ['action-walk'],
          generations: [],
          error: null,
          method: null,
        },
        {
          id: 'action-walk:action-full-frame',
          type: 'action-full-frame',
          status: 'locked',
          phase: 'ready',
          dependsOnNodeIds: ['action-walk:action-generation-method'],
          generations: [],
          error: null,
        },
        {
          id: 'action-walk:review',
          type: 'review',
          status: 'locked',
          phase: 'reviewing',
          dependsOnNodeIds: ['action-walk:action-full-frame'],
          generations: [],
          error: null,
        },
      ],
    }
    const service = {
      unavailableReason: null,
      start: vi.fn(),
      startWithUploadedTemplate: vi.fn(),
      continueWithUploadedTemplate: vi.fn(),
      startAction: vi.fn(),
      peekWorkflow: vi.fn(() => run),
      subscribe: vi.fn((_runId, listener) => {
        listener(run)
        return () => undefined
      }),
      resume: vi.fn(async () => run),
      interrupt: vi.fn(async () => run),
      confirmCandidate: vi.fn(),
      confirmFirstFrame: vi.fn(async () => run),
      approveReview: vi.fn(async () => run),
      getCharacterInfo: vi.fn(() => ({ characterId: 'character-1', outfitId: 'outfit-1' })),
      resolveCharacterInfo: vi.fn(async () => ({
        characterId: 'character-1',
        outfitId: 'outfit-1',
      })),
      getTemplateCandidates: vi.fn(async () => ['https://example.test/stale-template.png']),
      getFirstFrameCandidates: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/first-frame.png', durationMs: null },
      ]),
      getActionFrames: vi.fn(async () => []),
    } as unknown as QuickStartService

    const view = render(
      <MemoryRouter initialEntries={['/quick-start/run-1']}>
        <Routes>
          <Route path="/quick-start/:runId" element={<QuickStartPage service={service} />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(view.getByRole('heading', { name: '选择动作首帧' })).toBeTruthy()
    })
    expect(view.getByRole('img', { name: '动作首帧候选 1' })).toBeTruthy()
    expect(view.queryByRole('img', { name: '角色图候选 1' })).toBeNull()
  })
})
// @vitest-environment jsdom
