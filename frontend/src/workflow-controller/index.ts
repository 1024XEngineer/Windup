/**
 * 两种制作界面共享的整体 WorkflowController 契约。
 *
 * Controller 围绕同一份 WorkflowRun 数据提供推进、更新、重启和中断方法，不能把
 * 这些操作再拆成互不共享状态的独立模块。当前 PR 只确定公开接口；状态转换、业务
 * APIs 调用与持久化顺序在后续实现 PR 中完成。
 */
import type {
  CreateWorkflowRunInput,
  WorkflowRevision,
  WorkflowRun,
  WorkflowStep,
} from '../entities/workflow-run'

/** 更新当前 Revision 中某个 Step 的业务数据。 */
export interface UpdateWorkflowStepInput {
  stepId: WorkflowStep['id']
  data: unknown
}

/** 从指定 Revision 的指定 Step 建立新的执行版本。 */
export interface RestartWorkflowFromStepInput {
  revisionId: WorkflowRevision['id']
  stepId: WorkflowStep['id']
}

/** 把某个服务端业务调用的结果应用回目标 Step。 */
export interface ApplyWorkflowServerResultInput {
  /** 发起请求时所属的 Revision，防止旧异步结果污染重启后的新版本。 */
  revisionId: WorkflowRevision['id']
  stepId: WorkflowStep['id']
  result: unknown
}

/**
 * Quick Start 与 Workflow Editor 共用的整体流程接口。
 * 具体状态转换、服务端调用和持久化将在后续小 PR 中实现。
 */
export interface WorkflowController {
  /** 初始化一条创建角色或增加动作的 WorkflowRun。 */
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>
  /** 读取 Controller 当前维护的完整 WorkflowRun 快照。 */
  getWorkflow(): WorkflowRun
  /** 按前端规则完成当前 Step 并进入下一 Step。 */
  nextStep(): Promise<WorkflowRun>
  /** 更新指定 Step 数据，但不绕过 Controller 直接修改全局状态。 */
  updateStep(input: UpdateWorkflowStepInput): Promise<WorkflowRun>
  /** 从历史 Step 创建新 Revision，保留旧 Revision 只读。 */
  restartFromStep(input: RestartWorkflowFromStepInput): Promise<WorkflowRun>
  /** 中断自动流程；后续是否取消服务端 Task 由正式接口合同决定。 */
  interrupt(): Promise<WorkflowRun>
  /** 恢复被用户中断的自动流程，从当前 Revision 的 currentStepId 继续。 */
  resume(): Promise<WorkflowRun>
  /** 将 Project、Character、Generation 等服务端调用结果映射回目标 Step。 */
  applyServerResult(input: ApplyWorkflowServerResultInput): Promise<WorkflowRun>
}
