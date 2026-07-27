import type { WorkflowRun, WorkflowStep } from '../model/types'

/**
 * 工作流的本地存储。
 *
 * 后端当前不存 workflow（2026-07-27 确认），只提供图片与资源接口，所以这一层
 * 暂时由浏览器自己存。未来后端接管时，目标是优先替换 api/ 实现并删掉本文件；
 * 但 entities 对外签名尚未经前后端 Review，不在此预先保证零改动。
 *
 * 用 localStorage 而不是内存：刷新页面要能恢复现场，单帧退回也要找回当初那条工作流。
 * 拿不到 localStorage 时（隐私模式、测试环境）退回内存，此时数据只在本次运行内有效。
 */
const STORAGE_KEY = 'windup.workflow-runs'

type RunMap = Record<string, WorkflowRun>

let memory: RunMap = {}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readAll(): RunMap {
  const store = storage()
  if (!store) return memory
  try {
    const raw = store.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RunMap) : memory
  } catch {
    // 数据损坏时不让它把整个应用带崩
    return memory
  }
}

function writeAll(runs: RunMap): void {
  memory = runs
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(runs))
  } catch {
    // 配额满或隐私模式：已经写进 memory，本次运行内仍可用
  }
}

export function saveRun(run: WorkflowRun): WorkflowRun {
  const runs = readAll()
  runs[run.id] = run
  writeAll(runs)
  return run
}

export function loadRun(runId: string): WorkflowRun | null {
  return readAll()[runId] ?? null
}

export function newRunId(): string {
  return `run-${globalThis.crypto.randomUUID().slice(0, 8)}`
}

/** 一条新工作流的起始步骤：先生成母版，再确认。后续动作由用户/AI 逐个追加。 */
export function initialSteps(): WorkflowStep[] {
  return [
    { id: 'step-1', type: 'generate-template', status: 'pending', actionId: null, taskId: null },
    { id: 'step-2', type: 'confirm-template', status: 'pending', actionId: null, taskId: null },
  ]
}
