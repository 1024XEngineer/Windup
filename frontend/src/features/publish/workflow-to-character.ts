/**
 * WorkflowRun → Character 桥接层。
 * 从工作流步骤中提取数据，组装为 Playtest 可消费的 Character 实体。
 * 按 5 步流程读取：character-setup / character-template / template-candidate /
 * action-generation / review。
 */
import type {
  Action,
  Character,
  CharacterTemplateCandidate,
  Frame,
  Outfit,
  WorkflowRevision,
  WorkflowRun,
  WorkflowStep,
} from '@/entities'

function getRevision(run: WorkflowRun): WorkflowRevision | null {
  return run.revisions.find((r) => r.id === run.currentRevisionId) ?? null
}

function getStep(revision: WorkflowRevision, type: string): WorkflowStep | null {
  return revision.steps.find((s) => s.type === type) ?? null
}

/** 从 character-template 步骤提取母版 URL */
function extractCharacterTemplateUrl(revision: WorkflowRevision): string | null {
  const step = getStep(revision, 'character-template')
  const output = step?.output as { images?: Array<{ url: string }> } | null
  if (!output?.images?.length) return null
  return output.images[0]?.url ?? null
}

/** 从 character-template 步骤提取候选列表 */
function extractCandidates(revision: WorkflowRevision): CharacterTemplateCandidate[] {
  const step = getStep(revision, 'character-template')
  const output = step?.output as { images?: Array<{ url: string }> } | null
  if (!output?.images) return []
  return output.images.map((img, i) => ({
    id: `candidate-${i}`,
    imageUrl: img.url,
    attemptId: `attempt-${Date.now()}`,
  }))
}

/** 从 character-setup 步骤提取角色描述 */
function extractDescription(revision: WorkflowRevision): string {
  const step = getStep(revision, 'character-setup')
  const input = step?.input as { description?: string } | null
  return input?.description?.trim() || '未命名角色'
}

/** 动作生成结果的帧 URL 列表（兼容 first_frame 单帧与 complete_animation 多帧） */
function extractActionResult(revision: WorkflowRevision) {
  const step = getStep(revision, 'action-generation')
  return step?.type === 'action-generation' ? step.output : null
}

/**
 * 将 WorkflowRun 转换为 Character 实体。
 * 如果关键步骤未完成，返回 null。
 */
export function workflowRunToCharacter(run: WorkflowRun): Character | null {
  const revision = getRevision(run)
  if (!revision) return null

  const templateStep = getStep(revision, 'character-template')

  // 至少需要母版已生成
  if (!templateStep || templateStep.status !== 'passed') return null

  const characterTemplateUrl = extractCharacterTemplateUrl(revision)
  const candidates = extractCandidates(revision)
  const description = extractDescription(revision)
  const actionResult = extractActionResult(revision)

  // 构建帧列表
  const frames: Frame[] = (actionResult?.frames ?? []).map((frame) => ({
    imageUrl: frame.url,
    durationMs: frame.durationMs,
    rootMotion: null,
  }))

  // 构建动作
  const actions: Action[] = []
  if (frames.length > 0) {
    actions.push({
      id: `${run.id}-action`,
      outfitId: `${run.id}-outfit`,
      name: description.length > 8 ? `${description.slice(0, 8)}…` : description || '动作',
      expectedFrameCount: frames.length,
      kind: 'custom',
      type: actionResult?.actionType ?? 'custom',
      fps: 8,
      keyFrameIndex: null,
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
 * 至少需要：母版已确认 + 动作生成完成。
 */
export function canPublishToPlaytest(run: WorkflowRun): boolean {
  const revision = getRevision(run)
  if (!revision) return false

  const templateStep = getStep(revision, 'character-template')
  const actionStep = getStep(revision, 'action-generation')

  const reviewStep = getStep(revision, 'review')
  return (
    run.status === 'completed' &&
    templateStep?.status === 'passed' &&
    actionStep?.status === 'passed' &&
    reviewStep?.status === 'passed'
  )
}
