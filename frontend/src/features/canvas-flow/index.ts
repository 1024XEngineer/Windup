import type { ActionKind, ActionType } from '@/entities'

/**
 * 画布的卡片流程模型。
 *
 * 与 entities/workflow-run 的关系：WorkflowRun 描述的是一条线性推进的运行记录，
 * 这里描述的是画布上「哪张卡片接在哪张卡片下面」的树。两者不是同一个东西，
 * 本验证 PR 不试图把它们合并——真接后端时再决定谁承载谁。
 */

/** 卡片种类。种类由产品定义，用户只能从加号菜单里选，不能自己造。 */
export type CardKind =
  | 'origin'
  | 'candidates'
  | 'master'
  | 'first-frame'
  | 'animation'
  | 'review'
  | 'export'

/**
 * 卡片的生命周期。
 * idle 表示等待用户填写或提交，running 表示产物正在逐个到达，
 * review 表示产物已到齐等待确认，confirmed 表示已确认、可作为下游的上游。
 */
export type CardStatus = 'idle' | 'running' | 'review' | 'confirmed'

/**
 * 一个动作在这条分支上的规格。
 * kind 区分定义来源（预设 / 自定义），type 是业务语义，两者独立——
 * 自定义来源同样可以描述 walk，这与 entities/character 的定义一致。
 */
export interface ActionSpec {
  kind: ActionKind
  type: ActionType
  name: string
  /** 预设动作填一句步态描述；自定义动作还要填名称。 */
  brief: string
  frameCount: number
  fps: number
  /** 帧数被用户改过则为 true，卡片上据此显示覆盖记号。 */
  frameCountOverridden: boolean
}

export interface Card {
  id: string
  kind: CardKind
  /** 上游卡片；起点卡片没有上游。连线由这个字段推出来，用户不画线。 */
  parentId: string | null
  status: CardStatus
  /** 只有动作分支上的卡片（首帧、完整动画、审核）带规格。 */
  action: ActionSpec | null
  /** 已到达的产物 URL，按到达顺序排列。 */
  images: string[]
  /** 本次生成预期的产物总数；未开始生成时为 0。 */
  total: number
}

export interface CanvasGraph {
  cards: Card[]
  /** 起点卡片里填的角色描述。 */
  characterBrief: string
  /** 已选中的母版候选 ID。 */
  selectedCandidateId: string | null
}

/* ---------- 演示素材 ---------- */

/** 母版候选。四张都是 live demo 里已有的真实角色底图。 */
export const CANDIDATES = [
  { id: 'samurai', label: '武士', imageUrl: '/demo/candidates/samurai.png' },
  { id: 'boy', label: '少年', imageUrl: '/demo/candidates/boy.png' },
  { id: 'lirael', label: '法师', imageUrl: '/demo/candidates/lirael.png' },
  { id: 'skeleton', label: '骷髅', imageUrl: '/demo/candidates/skeleton.png' },
] as const

/**
 * 预设动作。规格已预先优化到位，用户只填一句描述。
 * 三个都有 samurai 的真实帧，所以演示全程不用占位图。
 */
export const PRESET_ACTIONS: readonly { type: ActionType; name: string; placeholder: string }[] = [
  { type: 'idle', name: 'Idle 待机', placeholder: '描述呼吸节奏、重心与待机时的小动作' },
  { type: 'walk', name: 'Walk 行走', placeholder: '描述步幅、重心起伏与行进速度' },
  { type: 'jump', name: 'Jump 跳跃', placeholder: '描述起跳发力、滞空姿态与落地缓冲' },
]

const FRAME_SOURCE: Record<string, string> = { idle: 'idle', walk: 'walk', jump: 'jump' }

/** 某个动作的帧路径。自定义动作没有对应素材，统一借用 jump 的帧演示。 */
export function framesOf(type: ActionType, count: number): string[] {
  const source = FRAME_SOURCE[type] ?? 'jump'
  return Array.from(
    { length: count },
    (_, i) => `/demo/samurai/${source}-${String((i % 36) + 1).padStart(2, '0')}.png`,
  )
}

/* ---------- 加号菜单 ---------- */

export interface PlusOption {
  id: string
  label: string
  /** 菜单项下方的一行说明；没有则不显示。 */
  hint?: string
  /** 本期不做但保留在菜单里的项，用于说明菜单可扩展。 */
  disabled?: boolean
  children?: PlusOption[]
}

/**
 * 一张卡片的全部合法下游。
 * 菜单只列合法项，所以用户挑不到非法组合，也就不存在连接后再报错的路径。
 */
export function plusOptions(card: Card): PlusOption[] {
  if (card.status !== 'confirmed') return []
  if (card.kind === 'master') {
    return [
      {
        id: 'action',
        label: '生成动作',
        children: [
          ...PRESET_ACTIONS.map((preset) => ({
            id: `preset:${preset.type}`,
            label: preset.name,
            hint: '预设动作 · 逐帧生成',
          })),
          { id: 'custom', label: '自定义动作', hint: '自己描述 · 图生视频' },
        ],
      },
      {
        id: 'static',
        label: '生成静态资产',
        hint: '本期不做，需单独提案',
        disabled: true,
      },
      { id: 'export', label: '导出', hint: '打包已确认的动作' },
    ]
  }
  if (card.kind === 'first-frame') {
    return [{ id: 'animation', label: '完整动画' }]
  }
  // 审核通过的动作可以直接进导出，不必绕回母版。
  if (card.kind === 'review') {
    return [{ id: 'export', label: '导出', hint: '打包已确认的动作' }]
  }
  return []
}

/* ---------- 图操作 ---------- */

let seq = 0
const nextId = (kind: CardKind) => `${kind}-${++seq}`

export function createGraph(): CanvasGraph {
  seq = 0
  return {
    cards: [
      {
        id: nextId('origin'),
        kind: 'origin',
        parentId: null,
        status: 'idle',
        action: null,
        images: [],
        total: 0,
      },
    ],
    characterBrief: '',
    selectedCandidateId: null,
  }
}

export function findCard(graph: CanvasGraph, id: string): Card | undefined {
  return graph.cards.find((card) => card.id === id)
}

/** 一张卡片的全部下游，含自身。删除时用它算影响范围。 */
export function descendants(graph: CanvasGraph, id: string): string[] {
  const collected = [id]
  for (let i = 0; i < collected.length; i += 1) {
    for (const card of graph.cards) {
      if (card.parentId === collected[i]) collected.push(card.id)
    }
  }
  return collected
}

export function removeCard(graph: CanvasGraph, id: string): CanvasGraph {
  const doomed = new Set(descendants(graph, id))
  return { ...graph, cards: graph.cards.filter((card) => !doomed.has(card.id)) }
}

export function updateCard(graph: CanvasGraph, id: string, patch: Partial<Card>): CanvasGraph {
  return {
    ...graph,
    cards: graph.cards.map((card) => (card.id === id ? { ...card, ...patch } : card)),
  }
}

function appendCard(graph: CanvasGraph, card: Card): CanvasGraph {
  return { ...graph, cards: [...graph.cards, card] }
}

/** 默认帧数与帧率来自动作定义，卡片正面不问，用户要改得展开高级项。 */
const DEFAULT_FRAME_COUNT = 36
const DEFAULT_FPS = 8

/**
 * 按加号菜单的选择追加一张卡片。
 * optionId 是 plusOptions 里叶子节点的 id；调用方保证它合法。
 */
export function addCard(graph: CanvasGraph, parentId: string, optionId: string): CanvasGraph {
  const parent = findCard(graph, parentId)
  if (!parent) return graph

  if (optionId === 'export') {
    // 导出是整张图的收口，母版和任一审核卡片都能开出它，但只留一张。
    if (graph.cards.some((card) => card.kind === 'export')) return graph
    return appendCard(graph, {
      id: nextId('export'),
      kind: 'export',
      parentId,
      status: 'idle',
      action: null,
      images: [],
      total: 0,
    })
  }

  if (optionId === 'animation' && parent.action) {
    return appendCard(graph, {
      id: nextId('animation'),
      kind: 'animation',
      parentId,
      status: 'idle',
      action: parent.action,
      images: [],
      total: 0,
    })
  }

  if (optionId.startsWith('preset:') || optionId === 'custom') {
    const custom = optionId === 'custom'
    const preset = custom ? null : PRESET_ACTIONS.find((item) => `preset:${item.type}` === optionId)
    if (!custom && !preset) return graph
    return appendCard(graph, {
      id: nextId('first-frame'),
      kind: 'first-frame',
      parentId,
      status: 'idle',
      action: {
        kind: (custom ? 'custom' : 'preset') as ActionKind,
        type: custom ? 'custom' : preset!.type,
        name: custom ? '' : preset!.name,
        brief: '',
        frameCount: DEFAULT_FRAME_COUNT,
        fps: DEFAULT_FPS,
        frameCountOverridden: false,
      },
      images: [],
      total: 0,
    })
  }

  return graph
}

/**
 * 起点确认后自动接上母版候选；候选选定后自动接上母版。审核同理，不经加号。
 *
 * status 默认 idle，但母版是个例外：它在候选被确认的那一刻就已锁定，
 * 自身没有可执行的动作，因此直接以 confirmed 落地——加号挂在它身上，
 * 若停在 idle 则整张图再也长不出下游。
 */
export function autoAppend(
  graph: CanvasGraph,
  parentId: string,
  kind: CardKind,
  status: CardStatus = 'idle',
): CanvasGraph {
  const parent = findCard(graph, parentId)
  if (!parent) return graph
  if (graph.cards.some((card) => card.parentId === parentId && card.kind === kind)) return graph
  return appendCard(graph, {
    id: nextId(kind),
    kind,
    parentId,
    status,
    action: parent.action,
    images: [],
    total: 0,
  })
}

/* ---------- 布局 ---------- */

const COLUMN: Record<CardKind, number> = {
  origin: 0,
  candidates: 1,
  master: 2,
  'first-frame': 3,
  animation: 4,
  review: 5,
  export: 6,
}

export const CARD_WIDTH: Record<CardKind, number> = {
  origin: 300,
  candidates: 320,
  master: 260,
  'first-frame': 300,
  animation: 400,
  review: 260,
  export: 280,
}

const COLUMN_X = [0, 360, 740, 1060, 1420, 1880, 2220]
const ROW_HEIGHT = 420

/**
 * 卡片位置由系统排布：列按种类固定，行按分支创建顺序。
 * 主干（起点到母版）占第 0 行，每条动作分支往下占一行，导出排在全部分支之后。
 */
export function layout(graph: CanvasGraph): Record<string, { x: number; y: number }> {
  const rowOf = new Map<string, number>()
  let branch = 0
  for (const card of graph.cards) {
    if (card.parentId === null) {
      rowOf.set(card.id, 0)
      continue
    }
    if (card.kind === 'first-frame') {
      branch += 1
      rowOf.set(card.id, branch)
      continue
    }
    rowOf.set(card.id, rowOf.get(card.parentId) ?? 0)
  }
  const exportRow = branch + 1
  const positions: Record<string, { x: number; y: number }> = {}
  for (const card of graph.cards) {
    const row = card.kind === 'export' ? exportRow : (rowOf.get(card.id) ?? 0)
    positions[card.id] = { x: COLUMN_X[COLUMN[card.kind]], y: row * ROW_HEIGHT }
  }
  return positions
}

/* ---------- 假执行 ---------- */

/** 每张产物之间的间隔，够看清逐张到达又不至于让演示拖沓。 */
const ARRIVAL_INTERVAL_MS = 120

export interface GenerationPlan {
  total: number
  urls: string[]
}

/** 一张卡片这次生成会产出什么。全部来自本地素材，不发请求。 */
export function planFor(card: Card): GenerationPlan {
  if (card.kind === 'candidates') {
    return { total: CANDIDATES.length, urls: CANDIDATES.map((item) => item.imageUrl) }
  }
  if (card.kind === 'first-frame' && card.action) {
    return { total: 1, urls: framesOf(card.action.type, 1) }
  }
  if (card.kind === 'animation' && card.action) {
    const urls = framesOf(card.action.type, card.action.frameCount)
    return { total: urls.length, urls }
  }
  if (card.kind === 'export') {
    return { total: 1, urls: [] }
  }
  return { total: 0, urls: [] }
}

/**
 * 逐张推送产物，模拟生成过程中的到达。
 * 返回取消函数；卡片被删除或组件卸载时调用，避免往已消失的卡片上写状态。
 */
export function runGeneration(
  plan: GenerationPlan,
  onArrive: (images: string[]) => void,
  onDone: () => void,
): () => void {
  let index = 0
  const timer = setInterval(() => {
    index += 1
    onArrive(plan.urls.slice(0, index))
    if (index >= plan.total) {
      clearInterval(timer)
      onDone()
    }
  }, ARRIVAL_INTERVAL_MS)
  return () => clearInterval(timer)
}
