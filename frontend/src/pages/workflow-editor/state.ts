/** 工作流状态机 */

export type NodeStatus = 'idle' | 'locked' | 'ready' | 'generating' | 'review' | 'confirmed'
export type SourceType = 'zero' | 'upload' | null

export interface MasterCandidate {
  id: string
  label: string
  src: string
}

export interface ActionBranch {
  keyframe: NodeStatus
  animation: NodeStatus
  keyframeUrl: string | null
  frames: string[]
}

export interface WorkflowSnapshot {
  status: 'idle' | 'active' | 'completed' | 'failed'
  source: SourceType
  sourceId: string | null
  master: NodeStatus
  masterCandidates: MasterCandidate[]
  selectedCandidate: string | null
  profile: { name: string; description: string; style: string }
  actions: { walk: ActionBranch; idle: ActionBranch }
  completed: boolean
}

const DEMO_CANDIDATES: MasterCandidate[] = [
  { id: 'boy', label: '少年', src: '' },
  { id: 'lamplighter', label: '守夜人', src: '' },
  { id: 'skeleton', label: '骷髅剑士', src: '' },
  { id: 'lirael', label: '暗色游侠', src: '' },
  { id: 'samurai', label: '武士', src: '' },
  { id: 'knight', label: '骑士', src: '' },
]

function createEmptyActionBranch(): ActionBranch {
  return { keyframe: 'idle', animation: 'idle', keyframeUrl: null, frames: [] }
}

export function createInitialSnapshot(): WorkflowSnapshot {
  return {
    status: 'idle',
    source: null,
    sourceId: null,
    master: 'idle',
    masterCandidates: [],
    selectedCandidate: null,
    profile: { name: '', description: '', style: '' },
    actions: { walk: createEmptyActionBranch(), idle: createEmptyActionBranch() },
    completed: false,
  }
}

export type WorkflowAction =
  | { type: 'SELECT_SOURCE'; source: SourceType; sourceId: string }
  | { type: 'SUBMIT_MASTER_BRIEF'; profile: { name: string; description: string; style: string } }
  | { type: 'MASTER_CANDIDATE_ARRIVED'; candidate: MasterCandidate }
  | { type: 'SELECT_MASTER_CANDIDATE'; candidateId: string }
  | { type: 'CONFIRM_MASTER' }
  | { type: 'GENERATE_KEYFRAME'; action: 'walk' | 'idle'; brief: string }
  | { type: 'KEYFRAME_ARRIVED'; action: 'walk' | 'idle'; url: string }
  | { type: 'CONFIRM_KEYFRAME'; action: 'walk' | 'idle' }
  | { type: 'GENERATE_ANIMATION'; action: 'walk' | 'idle'; fps: number }
  | { type: 'ANIMATION_FRAME_ARRIVED'; action: 'walk' | 'idle'; frameIndex: number; url: string }
  | { type: 'CONFIRM_ANIMATION'; action: 'walk' | 'idle' }
  | { type: 'PUBLISH' }
  | { type: 'RESET' }

export function reduceWorkflow(state: WorkflowSnapshot, action: WorkflowAction): WorkflowSnapshot {
  switch (action.type) {
    case 'SELECT_SOURCE':
      return { ...state, status: 'active', source: action.source, sourceId: action.sourceId, master: 'ready' }
    case 'SUBMIT_MASTER_BRIEF':
      return { ...state, profile: action.profile, master: 'generating', masterCandidates: [], selectedCandidate: null }
    case 'MASTER_CANDIDATE_ARRIVED':
      return { ...state, masterCandidates: [...state.masterCandidates, action.candidate] }
    case 'SELECT_MASTER_CANDIDATE':
      return { ...state, selectedCandidate: action.candidateId, master: 'review' }
    case 'CONFIRM_MASTER':
      return { ...state, master: 'confirmed', actions: { walk: { ...state.actions.walk, keyframe: 'ready' }, idle: { ...state.actions.idle, keyframe: 'ready' } } }
    case 'GENERATE_KEYFRAME':
      return { ...state, actions: { ...state.actions, [action.action]: { ...state.actions[action.action], keyframe: 'generating' } } }
    case 'KEYFRAME_ARRIVED':
      return { ...state, actions: { ...state.actions, [action.action]: { ...state.actions[action.action], keyframe: 'review', keyframeUrl: action.url } } }
    case 'CONFIRM_KEYFRAME':
      return { ...state, actions: { ...state.actions, [action.action]: { ...state.actions[action.action], keyframe: 'confirmed', animation: 'ready' } } }
    case 'GENERATE_ANIMATION':
      return { ...state, actions: { ...state.actions, [action.action]: { ...state.actions[action.action], animation: 'generating', frames: [] } } }
    case 'ANIMATION_FRAME_ARRIVED': {
      const branch = state.actions[action.action]
      const frames = [...branch.frames]
      frames[action.frameIndex] = action.url
      return { ...state, actions: { ...state.actions, [action.action]: { ...branch, frames } } }
    }
    case 'CONFIRM_ANIMATION':
      return { ...state, actions: { ...state.actions, [action.action]: { ...state.actions[action.action], animation: 'confirmed' } } }
    case 'PUBLISH':
      return { ...state, completed: true, status: 'completed' }
    case 'RESET':
      return createInitialSnapshot()
    default:
      return state
  }
}

export function simulateMasterGeneration(dispatch: (action: WorkflowAction) => void): () => void {
  let cancelled = false
  async function run() {
    for (const candidate of DEMO_CANDIDATES) {
      if (cancelled) return
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 400))
      if (cancelled) return
      dispatch({ type: 'MASTER_CANDIDATE_ARRIVED', candidate })
    }
  }
  run()
  return () => { cancelled = true }
}

export function simulateKeyframeGeneration(action: 'walk' | 'idle', dispatch: (action: WorkflowAction) => void): () => void {
  let cancelled = false
  async function run() {
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000))
    if (cancelled) return
    dispatch({ type: 'KEYFRAME_ARRIVED', action, url: `https://placehold.co/256x256/263f2d/fff?text=${action}+key` })
  }
  run()
  return () => { cancelled = true }
}

export function simulateAnimationGeneration(action: 'walk' | 'idle', dispatch: (action: WorkflowAction) => void): () => void {
  let cancelled = false
  async function run() {
    for (let i = 0; i < 8; i++) {
      if (cancelled) return
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 400))
      if (cancelled) return
      dispatch({ type: 'ANIMATION_FRAME_ARRIVED', action, frameIndex: i, url: `https://placehold.co/128x128/263f2d/fff?text=${action}+${i + 1}` })
    }
  }
  run()
  return () => { cancelled = true }
}
