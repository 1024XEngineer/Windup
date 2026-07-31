/**
 * WorkflowRun → Character 桥接层。
 * 从工作流步骤中提取数据，组装为 Playtest 可消费的 Character 实体。
 */
import type {
  Character,
  Outfit,
  Action,
  Frame,
  ActionType,
  CharacterTemplateCandidate,
} from '@/entities/character'
import type { WorkflowRun, WorkflowRevision, WorkflowStep } from '@/entities'

function getRevision(run: WorkflowRun): WorkflowRevision | null {
  return run.revisions.find((r) => r.id === run.currentRevisionId) ?? null
}

function getStep(revision: WorkflowRevision, type: string): WorkflowStep | null {
  return revision.steps.find((s) => s.type === type) ?? null
}

function getStepOutput(revision: WorkflowRevision, type: string): unknown {
  const step = getStep(revision, type)
  return (step as any)?.output ?? null
}

function getStepInput(revision: WorkflowRevision, type: string): unknown {
  const step = getStep(revision, type)
  return (step as any)?.input ?? null
}

/** 从 character-template 步骤提取母版 URL */
function extractCharacterTemplateUrl(revision: WorkflowRevision): string | null {
  const output = getStepOutput(revision, 'character-template') as { images?: Array<{ url: string }> } | null
  if (!output?.images?.length) return null
  return output.images[0]?.url ?? null
}

/** 从 character-template 步骤提取候选列表 */
function extractCandidates(revision: WorkflowRevision): CharacterTemplateCandidate[] {
  const output = getStepOutput(revision, 'character-template') as { images?: Array<{ url: string }> } | null
  if (!output?.images) return []
  return output.images.map((img, i) => ({
    id: `candidate-${i}`,
    imageUrl: img.url,
    attemptId: `attempt-${Date.now()}`,
  }))
}

/** 从 first-frame 步骤提取首帧 URL */
function extractFirstFrameUrl(revision: WorkflowRevision, actionType: string): string | null {
  const output = getStepOutput(revision, 'first-frame') as { url?: string; actionType?: string } | null
  if (!output?.url) return null
  // 如果有多个动作，按 actionType 区分
  if (output.actionType && output.actionType !== actionType) return null
  return output.url
}

/** 从 complete-animation 步骤提取帧列表 */
function extractAnimationFrames(revision: WorkflowRevision, actionType: string): string[] {
  const output = getStepOutput(revision, 'complete-animation') as { frames?: string[]; actionType?: string } | null
  if (!output?.frames?.length) return []
  if (output.actionType && output.actionType !== actionType) return []
  return output.frames
}

/** 从 action-setup 步骤提取选定的动作类型 */
function extractSelectedActionType(revision: WorkflowRevision): ActionType {
  const input = getStepInput(revision, 'action-setup') as { actionType?: string } | null
  const raw = input?.actionType ?? 'walk'
  const valid: ActionType[] = ['walk', 'idle', 'attack', 'jump', 'custom']
  return valid.includes(raw as ActionType) ? (raw as ActionType) : 'walk'
}

/** 从 character-setup 步骤提取角色描述 */
function extractDescription(revision: WorkflowRevision): string {
  const input = getStepInput(revision, 'character-setup') as { description?: string } | null
  return input?.description?.trim() || '未命名角色'
}

/**
 * 将 WorkflowRun 转换为 Character 实体。
 * 如果关键步骤未完成，返回 null。
 */
export function workflowRunToCharacter(run: WorkflowRun): Character | null {
  const revision = getRevision(run)
  if (!revision) return null

  const templateStep = getStep(revision, 'character-template')
  const candidateStep = getStep(revision, 'template-candidate')
  const actionStep = getStep(revision, 'action-setup')
  const keyframeStep = getStep(revision, 'first-frame')
  const animationStep = getStep(revision, 'complete-animation')

  // 至少需要母版已生成
  if (!templateStep || templateStep.status !== 'passed') return null

  const characterTemplateUrl = extractCharacterTemplateUrl(revision)
  const candidates = extractCandidates(revision)
  const description = extractDescription(revision)
  const actionType = extractSelectedActionType(revision)
  const firstFrameUrl = extractFirstFrameUrl(revision, actionType)
  const animationFrames = extractAnimationFrames(revision, actionType)

  // 构建帧列表
  const frames: Frame[] = []

  // 如果有首帧，加入
  if (firstFrameUrl) {
    frames.push({
      imageUrl: firstFrameUrl,
      durationMs: 125, // 8 FPS default
      rootMotion: null,
    })
  }

  // 如果有动画帧，加入
  if (animationFrames.length > 0) {
    for (const url of animationFrames) {
      frames.push({
        imageUrl: url,
        durationMs: 125,
        rootMotion: null,
      })
    }
  }

  // 构建动作
  const actions: Action[] = []
  if (frames.length > 0) {
    actions.push({
      id: `${run.id}-${actionType}`,
      outfitId: `${run.id}-outfit`,
      name: actionType === 'walk' ? '行走' : actionType === 'idle' ? '待机' : actionType,
      kind: 'custom',
      type: actionType,
      fps: 8,
      keyFrameIndex: firstFrameUrl ? 0 : null,
      frames,
    })
  }

  // 构建造型
  const outfit: Outfit = {
    id: `${run.id}-outfit`,
    characterId: run.id,
    name: '默认造型',
    candidateCharacterTemplates: candidates,
    characterTemplateUrl,
    baseFrames: characterTemplateUrl ? [{ imageUrl: characterTemplateUrl }] : [],
    actions,
  }

  // 构建角色
  const character: Character = {
    id: run.id,
    projectId: run.projectId,
    outfits: [outfit],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  return character
}

/**
 * 检查 WorkflowRun 是否已准备好导出到 Playtest。
 * 至少需要：母版已确认 + 有一个动作的帧数据。
 */
export function canExportToPlaytest(run: WorkflowRun): boolean {
  const revision = getRevision(run)
  if (!revision) return false

  const templateStep = getStep(revision, 'character-template')
  const animationStep = getStep(revision, 'complete-animation')

  return (
    templateStep?.status === 'passed' &&
    animationStep?.status === 'passed'
  )
}

/**
 * 生成 Playtest 跳转 URL。
 */
export function buildPlaytestUrl(character: Character): string {
  const outfit = character.outfits[0]
  if (!outfit) return '/playtest/demo'

  const firstAction = outfit.actions[0]
  const actionParam = firstAction ? `?actionId=${firstAction.id}` : ''
  return `/playtest/${encodeURIComponent(character.id)}/${encodeURIComponent(outfit.id)}${actionParam}`
}
