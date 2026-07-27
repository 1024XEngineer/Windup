import { useAsync } from '@/shared/lib'
import type { AsyncState } from '@/shared/lib'
import { fetchWorkflowRun } from './api/get-workflow-run'
import type { TaskEvent } from './model/task'
import type { WorkflowRun } from './model/types'

/**
 * 两个入口共用的运行数据与命令。
 * 后端接口尚未提供，下面的签名即我们提给后端的需求。
 */

export { createWorkflowRun } from './api/create-workflow-run'
export { fetchWorkflowRun } from './api/get-workflow-run'
export { submitWorkflowStep } from './api/submit-workflow-step'
export { workflowRunKeys } from './model/queries'
export {
  availableCommands,
  currentStep,
  locateFrame,
  suggestNextCommand,
} from './model/selectors'
export type { TaskEvent, TaskStatus } from './model/task'
export type {
  CreateWorkflowRunInput,
  WorkflowCommand,
  WorkflowCommandKind,
  WorkflowDriver,
  WorkflowLocation,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowStepType,
} from './model/types'

/**
 * 订阅一个异步任务的进度，返回取消订阅的函数。
 *
 * 给的是 TaskEvent 而不是 WorkflowStep：任务与工作流步骤不是一回事，
 * 拿到终态后由调用方决定要不要重新拉 WorkflowRun。
 *
 * 当前只是向后端提出的能力需求，传输协议未定（端点、事件名、result 结构、
 * 重连策略四项都缺，见 model/task.ts）。它是同步函数，一旦在 useEffect 里
 * 调用会直接抛到错误边界，因此协议确定前**不要接调用点**；届时补的是实现，
 * 签名不变。
 */
export function subscribeTask(
  _taskId: string,
  _onEvent: (event: TaskEvent) => void,
): () => void {
  throw new Error('subscribeTask 的 SSE 协议尚未与后端确定，暂不可调用')
}

/** 订阅一次运行。 */
export function useWorkflowRun(runId: string): AsyncState<WorkflowRun> {
  return useAsync(() => fetchWorkflowRun(runId), [runId])
}
