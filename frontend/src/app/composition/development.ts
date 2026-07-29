import type { GenerationInput, GenerationResultFor } from '@/capabilities/image-generation'
import type { MediaReference, Task, WorkflowRevision, WorkflowRun } from '@/entities'
import { WORKFLOW_NODE_ORDER } from '@/entities'
import type { AppServices } from './types'

/**
 * Preview/本地开发组合。所有实现都遵守与真实后端相同的异步 Port，页面不感知 Mock；
 * 正式 HTTP Adapter 到位后只替换这里的装配，不修改页面签名。
 */
export function createDevelopmentAppServices(): AppServices {
  let sequence = 0
  const nextId = (prefix: string): string => `${prefix}-${++sequence}`
  const now = (): string => new Date().toISOString()

  const projects = new Map<string, Awaited<ReturnType<AppServices['projects']['get']>>>()
  const characters = new Map<string, Awaited<ReturnType<AppServices['characters']['get']>>>()
  const workflowRuns = new Map<string, WorkflowRun>()
  const tasks = new Map<string, Task>()
  const inspections = new Map<
    string,
    Awaited<ReturnType<AppServices['playtestInspections']['record']>>
  >()

  const services: AppServices = {
    projects: {
      async list(query = {}) {
        const page = query.page ?? 1
        const pageSize = query.pageSize ?? 20
        const all = [...projects.values()]
        const start = (page - 1) * pageSize
        return { items: all.slice(start, start + pageSize), total: all.length, page, pageSize }
      },
      async get(id) {
        const project = projects.get(id)
        if (!project) throw new Error(`项目不存在：${id}`)
        return project
      },
      async create(input) {
        const timestamp = now()
        const project = {
          id: nextId('project'),
          ownerId: 'mock-user',
          name: input.name,
          perspective: input.perspective,
          directionalMovement: input.directionalMovement,
          spriteSize: input.spriteSize,
          gameStyle: input.gameStyle ?? null,
          sampleImageUrl: input.sampleImageUrl ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        projects.set(project.id, project)
        return project
      },
      async remove(id) {
        projects.delete(id)
      },
    },
    characters: {
      async get(id) {
        const character = characters.get(id)
        if (!character) throw new Error(`角色不存在：${id}`)
        return character
      },
      async listByProject(projectId) {
        return [...characters.values()].filter((character) => character.projectId === projectId)
      },
      async create(input) {
        const timestamp = now()
        const character = {
          id: nextId('character'),
          projectId: input.projectId,
          name: input.name,
          outfits: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        characters.set(character.id, character)
        return character
      },
      async update(character) {
        if (!characters.has(character.id)) throw new Error(`角色不存在：${character.id}`)
        const updated = { ...character, updatedAt: now() }
        characters.set(updated.id, updated)
        return updated
      },
    },
    workflowRuns: {
      async create(input) {
        const revisionId = nextId('revision')
        const firstActive = input.purpose === 'add_action' ? 'action-setup' : 'character-setup'
        const revision: WorkflowRevision = {
          id: revisionId,
          basedOnRevisionId: null,
          restartNodeId: null,
          status: 'active',
          nodes: WORKFLOW_NODE_ORDER.map((type) => ({
            id: nextId('node'),
            type,
            status: type === firstActive ? 'active' : 'locked',
            input:
              type === firstActive
                ? {
                    characterTemplateUrl: input.characterTemplateUrl ?? null,
                    baseFrameUrls: input.baseFrameUrls ?? [],
                  }
                : null,
            output: null,
            referenceNodeIds: [],
          })),
          generationStatus: 'not_started',
          exportStatus: 'not_exported',
          createdAt: now(),
        }
        const run: WorkflowRun = {
          id: nextId('run'),
          projectId: input.projectId,
          characterId: input.characterId ?? null,
          outfitId: input.outfitId ?? null,
          purpose: input.purpose,
          driver: input.driver,
          status: 'active',
          currentRevisionId: revisionId,
          revisions: [revision],
          prompt: input.prompt?.trim() || null,
        }
        workflowRuns.set(run.id, run)
        return run
      },
      async get(runId) {
        return workflowRuns.get(runId) ?? null
      },
      async save(run) {
        workflowRuns.set(run.id, run)
      },
    },
    imageGeneration: {
      async submit(input) {
        const task: Task<typeof input.type> = {
          id: nextId('task'),
          type: input.type,
          status: 'completed',
          error: null,
          result: mockGenerationResult(input),
        }
        tasks.set(task.id, task)
        return task
      },
    },
    tasks: {
      async get(taskId) {
        const task = tasks.get(taskId)
        if (!task) throw new Error(`任务不存在：${taskId}`)
        return task
      },
      async cancel(taskId) {
        const task = tasks.get(taskId)
        if (!task) return
        tasks.set(taskId, { ...task, status: 'failed', error: '用户取消' })
      },
    },
    taskEvents: {
      subscribe(taskId, onEvent) {
        const task = tasks.get(taskId)
        if (task) {
          queueMicrotask(() =>
            onEvent({
              taskId,
              type: task.type,
              status: task.status,
              error: task.error,
              result: task.result,
            }),
          )
        }
        return () => undefined
      },
    },
    imageUpload: {
      async upload(file) {
        return `https://mock.windup.local/${encodeURIComponent(file.name)}` as MediaReference
      },
    },
    quickStart: {
      async start(request) {
        const project = await services.projects.create({
          name: request.prompt.trim().slice(0, 12) || '未命名项目',
          perspective: 'side',
          directionalMovement: 'single',
          spriteSize: { width: 64, height: 64 },
          gameStyle: null,
          sampleImageUrl: null,
        })
        const run = await services.workflowRuns.create({
          projectId: project.id,
          driver: 'ai',
          purpose: 'create_character',
          prompt: request.prompt,
        })
        setTimeout(() => {
          void services.workflowController.runToCompletion(run.id).catch(async () => {
            const latest = await services.workflowRuns.get(run.id)
            if (latest?.status === 'active') {
              await services.workflowRuns.save({ ...latest, status: 'failed' })
            }
          })
        }, 0)
        return { projectId: project.id, runId: run.id }
      },
      async getSession(runId) {
        const run = await services.workflowRuns.get(runId)
        if (!run) throw new Error(`Quick Start 会话不存在：${runId}`)
        const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
        return {
          projectId: run.projectId,
          runId: run.id,
          status: run.status,
          currentStage: revision?.nodes.find((node) => node.status === 'active')?.type ?? null,
        }
      },
      async interrupt(runId) {
        const run = await services.workflowRuns.get(runId)
        if (run?.status === 'active') {
          await services.workflowRuns.save({ ...run, status: 'interrupted' })
        }
      },
    },
    productionEngine: {
      async generate({ request }) {
        const submitted = await services.imageGeneration.submit(request)
        const task = await services.tasks.get(submitted.id)
        if (task.status !== 'completed') {
          throw new Error(`预览生成任务未完成：${task.id}`)
        }
        return task.result as GenerationResultFor<typeof request>
      },
      async cancelAttempt() {
        return undefined
      },
    },
    workflowRestart: {
      async restart({ run, sourceRevisionId, node }) {
        const source = run.revisions.find((revision) => revision.id === sourceRevisionId)
        if (!source) throw new Error(`工作流版本不存在：${sourceRevisionId}`)
        const restartIndex = source.nodes.findIndex((item) => item.id === node.id)
        if (restartIndex < 0) throw new Error(`重启节点不属于来源版本：${node.id}`)
        const revision: WorkflowRevision = {
          ...source,
          id: nextId('revision'),
          basedOnRevisionId: source.id,
          restartNodeId: node.id,
          status: 'active',
          nodes: source.nodes.map((item, index) => ({
            ...item,
            id: nextId('node'),
            status: index < restartIndex ? 'passed' : index === restartIndex ? 'active' : 'locked',
            output: index < restartIndex ? item.output : null,
            referenceNodeIds: index < restartIndex ? [...item.referenceNodeIds, item.id] : [],
          })),
          generationStatus:
            restartIndex <= WORKFLOW_NODE_ORDER.indexOf('complete-animation')
              ? 'in_progress'
              : source.generationStatus,
          exportStatus: 'not_exported',
          createdAt: now(),
        }
        const updated = {
          ...run,
          status: 'active' as const,
          currentRevisionId: revision.id,
          revisions: [
            ...run.revisions.map((item) =>
              item.id === source.id && item.status === 'active'
                ? { ...item, status: 'abandoned' as const }
                : item,
            ),
            revision,
          ],
        }
        await services.workflowRuns.save(updated)
        return updated
      },
    },
    workflowController: {
      async advance(runId) {
        const run = await services.workflowRuns.get(runId)
        if (!run) throw new Error(`工作流不存在：${runId}`)
        if (run.status !== 'active') return run
        const revision = run.revisions.find((item) => item.id === run.currentRevisionId)
        if (!revision) throw new Error(`当前工作流版本不存在：${run.currentRevisionId}`)
        const activeIndex = revision.nodes.findIndex((node) => node.status === 'active')
        if (activeIndex < 0) return run
        const activeNode = revision.nodes[activeIndex]
        if (!activeNode) return run
        if (activeNode.type === 'review') throw new Error('Review 能力尚未配置')
        if (activeNode.type === 'export') throw new Error('Export 能力尚未配置')
        let step: Awaited<ReturnType<typeof executePreviewStep>>
        try {
          step = await executePreviewStep(run, revision, activeNode)
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : '工作流步骤执行失败'
          const failedRevision: WorkflowRevision = {
            ...revision,
            status: 'failed',
            generationStatus: isGenerationNode(activeNode.type)
              ? 'failed'
              : revision.generationStatus,
            nodes: revision.nodes.map((node) =>
              node.id === activeNode.id
                ? { ...node, status: 'failed', output: { error: message } }
                : node,
            ),
          }
          await services.workflowRuns.save({
            ...run,
            status: 'failed',
            revisions: run.revisions.map((item) =>
              item.id === failedRevision.id ? failedRevision : item,
            ),
          })
          throw reason
        }
        const isLast = activeIndex === revision.nodes.length - 1
        const nodes = revision.nodes.map((node, index) => {
          if (index === activeIndex) {
            return { ...node, status: 'passed' as const, output: step.output }
          }
          if (!isLast && index === activeIndex + 1) return { ...node, status: 'active' as const }
          return node
        })
        const updatedRevision: WorkflowRevision = {
          ...revision,
          nodes,
          status: isLast ? 'completed' : revision.status,
          generationStatus:
            activeNode.type === 'complete-animation'
              ? 'completed'
              : activeIndex >= WORKFLOW_NODE_ORDER.indexOf('character-template')
                ? 'in_progress'
                : revision.generationStatus,
          exportStatus: revision.exportStatus,
        }
        const updated: WorkflowRun = {
          ...step.run,
          status: isLast ? 'completed' : 'active',
          revisions: run.revisions.map((item) =>
            item.id === updatedRevision.id ? updatedRevision : item,
          ),
        }
        await services.workflowRuns.save(updated)
        return updated
      },
      async runToCompletion(runId) {
        let run = await services.workflowRuns.get(runId)
        if (!run) throw new Error(`工作流不存在：${runId}`)
        for (
          let index = 0;
          index < WORKFLOW_NODE_ORDER.length && run.status === 'active';
          index += 1
        ) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          const latest = await services.workflowRuns.get(runId)
          if (!latest) throw new Error(`工作流不存在：${runId}`)
          run = latest
          if (run.status !== 'active') break
          const revision = latest.revisions.find((item) => item.id === latest.currentRevisionId)
          const activeNode = revision?.nodes.find((node) => node.status === 'active')
          if (!activeNode || activeNode.type === 'review' || activeNode.type === 'export') break
          run = await services.workflowController.advance(runId)
        }
        return run
      },
    },
    playtestInspections: {
      async getLatest(target) {
        return inspections.get(`${target.characterId}:${target.outfitId}`) ?? null
      },
      async record(input) {
        const key = `${input.characterId}:${input.outfitId}`
        const previous = inspections.get(key)
        const timestamp = now()
        const inspection = {
          id: previous?.id ?? nextId('inspection'),
          characterId: input.characterId,
          outfitId: input.outfitId,
          source: input.source ?? null,
          status: input.status,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        }
        inspections.set(key, inspection)
        return inspection
      },
    },
  }

  async function executePreviewStep(
    run: WorkflowRun,
    revision: WorkflowRevision,
    node: WorkflowRevision['nodes'][number],
  ): Promise<{ run: WorkflowRun; output: unknown }> {
    if (node.type === 'character-setup') {
      const character = await services.characters.create({
        projectId: run.projectId,
        name: run.prompt?.slice(0, 12) || '未命名角色',
        description: run.prompt ?? '',
      })
      const outfitId = nextId('outfit')
      await services.characters.update({
        ...character,
        outfits: [
          {
            id: outfitId,
            characterId: character.id,
            name: '默认造型',
            candidateCharacterTemplates: [],
            characterTemplateUrl: null,
            baseFrames: [],
            actions: [],
          },
        ],
      })
      return {
        run: { ...run, characterId: character.id, outfitId },
        output: { characterId: character.id, outfitId },
      }
    }

    const characterId = run.characterId
    const outfitId = run.outfitId
    if (!characterId || !outfitId) {
      throw new Error(`工作流阶段 ${node.type} 缺少 Character 或 Outfit 归属`)
    }
    const character = await services.characters.get(characterId)
    const outfit = character.outfits.find((item) => item.id === outfitId)
    if (!outfit) throw new Error(`造型不存在：${outfitId}`)
    const target = {
      runId: run.id,
      revisionId: revision.id,
      nodeId: node.id,
      attemptId: nextId('attempt'),
    }

    if (node.type === 'character-template') {
      const result = await services.productionEngine.generate({
        target,
        request: {
          type: 'character_template',
          projectId: run.projectId,
          prompt: run.prompt ?? character.name,
          referenceMedia: [],
        },
      })
      const candidates = result.images.map((image) => ({
        id: nextId('candidate'),
        imageUrl: image.url,
        attemptId: target.attemptId,
      }))
      await services.characters.update({
        ...character,
        outfits: character.outfits.map((item) =>
          item.id === outfitId ? { ...item, candidateCharacterTemplates: candidates } : item,
        ),
      })
      return { run, output: result }
    }

    if (node.type === 'template-candidate') {
      const candidate = outfit.candidateCharacterTemplates[0]
      if (!candidate) throw new Error('没有可确认的角色母版候选')
      const baseFrames = Array.from({ length: 4 }, (_, index) => ({
        imageUrl: `${candidate.imageUrl}?base-direction=${index + 1}`,
      }))
      await services.characters.update({
        ...character,
        outfits: character.outfits.map((item) =>
          item.id === outfitId
            ? { ...item, characterTemplateUrl: candidate.imageUrl, baseFrames }
            : item,
        ),
      })
      return { run, output: { candidateId: candidate.id, baseFrames } }
    }

    if (node.type === 'action-setup') {
      const action = {
        id: nextId('action'),
        outfitId,
        name: '待机',
        kind: 'preset' as const,
        type: 'idle' as const,
        status: 'planned' as const,
        fps: 8,
        keyFrameIndex: null,
        frames: [],
      }
      await services.characters.update({
        ...character,
        outfits: character.outfits.map((item) =>
          item.id === outfitId ? { ...item, actions: [...item.actions, action] } : item,
        ),
      })
      return { run, output: { actionId: action.id } }
    }

    const currentAction = outfit.actions.at(-1)
    if (node.type === 'first-frame') {
      if (!currentAction) throw new Error('尚未设置动作')
      const result = await services.productionEngine.generate({
        target,
        request: {
          type: 'first_frame',
          projectId: run.projectId,
          characterId,
          outfitId,
          actionType: currentAction.type,
          prompt: run.prompt,
          referenceMedia: [],
        },
      })
      const frames = [
        {
          imageUrl: result.image.url,
          durationMs: null,
          rootMotion: null,
          qc: 'pending' as const,
          rejected: false,
        },
      ]
      await updateOutfitAction(character, outfitId, currentAction.id, {
        ...currentAction,
        status: 'generating',
        frames,
      })
      return { run, output: result }
    }

    if (node.type === 'complete-animation') {
      if (!currentAction?.frames[0]) throw new Error('尚未生成动作首帧')
      const result = await services.productionEngine.generate({
        target,
        request: {
          type: 'complete_animation',
          projectId: run.projectId,
          characterId,
          outfitId,
          actionType: currentAction.type,
          firstFrameUrl: currentAction.frames[0].imageUrl,
          prompt: run.prompt,
          referenceMedia: [],
        },
      })
      await updateOutfitAction(character, outfitId, currentAction.id, {
        ...currentAction,
        status: 'confirmed',
        frames: result.frames.map((frame) => ({
          imageUrl: frame.url,
          durationMs: null,
          rootMotion: null,
          qc: 'pending',
          rejected: false,
        })),
      })
      return { run, output: result }
    }

    throw new Error(`Preview 未实现工作流阶段：${node.type}`)
  }

  function isGenerationNode(type: WorkflowRevision['nodes'][number]['type']): boolean {
    return type === 'character-template' || type === 'first-frame' || type === 'complete-animation'
  }

  async function updateOutfitAction(
    character: Awaited<ReturnType<AppServices['characters']['get']>>,
    outfitId: string,
    actionId: string,
    action: Awaited<
      ReturnType<AppServices['characters']['get']>
    >['outfits'][number]['actions'][number],
  ): Promise<void> {
    await services.characters.update({
      ...character,
      outfits: character.outfits.map((item) =>
        item.id === outfitId
          ? {
              ...item,
              actions: item.actions.map((existing) =>
                existing.id === actionId ? action : existing,
              ),
            }
          : item,
      ),
    })
  }

  return services
}

function mockGenerationResult<T extends GenerationInput>(input: T): GenerationResultFor<T> {
  const base = 'https://mock.windup.local/generated'
  if (input.type === 'character_template') {
    return {
      type: 'character_template',
      images: Array.from({ length: 6 }, (_, index) => ({
        url: `${base}/template-${index + 1}.png`,
      })),
    } as unknown as GenerationResultFor<T>
  }
  if (input.type === 'first_frame') {
    return {
      type: 'first_frame',
      image: { url: `${base}/first-frame.png` },
    } as unknown as GenerationResultFor<T>
  }
  return {
    type: 'complete_animation',
    frames: Array.from({ length: 8 }, (_, index) => ({ url: `${base}/frame-${index + 1}.png` })),
  } as unknown as GenerationResultFor<T>
}
