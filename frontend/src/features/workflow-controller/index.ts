import type {
  CreateWorkflowRunInput,
  WorkflowRevision,
  WorkflowRun,
  WorkflowStep,
} from '@/entities'

/** 更新当前 Revision 中某个步骤的业务数据。 */
export interface UpdateWorkflowStepInput {
  stepId: WorkflowStep['id']
  data: unknown
}

/** 从指定 Revision 的指定步骤建立新的执行版本。 */
export interface RestartWorkflowFromStepInput {
  revisionId: WorkflowRevision['id']
  stepId: WorkflowStep['id']
}

/** 把某次服务端调用的结果写回目标步骤。 */
export interface ApplyServerResultInput {
  /** 发起请求时所属的 Revision，防止旧的异步结果污染重启后的新版本。 */
  revisionId: WorkflowRevision['id']
  stepId: WorkflowStep['id']
  result: unknown
}

/**
 * Quick Start 与手动工作流共用的流程推进边界，不含界面。
 * 两套界面共享同一套流程：手动模式一次推进一步，Quick Start 连续推进到终点。
 *
 * Controller 围绕同一份 WorkflowRun 提供推进、更新、重启和中断。这些操作依赖同一份
 * 步骤数据，不拆成互不共享状态的独立模块。
 *
 * 步骤怎么走由前端决定，服务端只负责持久化 WorkflowRun 和提供生成能力。
 */
export interface WorkflowController {
  /** 初始化一条创建角色或增加动作的流程。 */
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>

  /** 读取当前维护的完整流程快照。 */
  getWorkflow(): WorkflowRun

  /** 按前端规则完成当前步骤并进入下一步；需要服务端时创建对应的 generation。 */
  nextStep(): Promise<WorkflowRun>

  /** 连续推进到终点，Quick Start 使用。 */
  runToCompletion(): Promise<WorkflowRun>

  /** 更新指定步骤的数据；页面不绕过 Controller 直接改流程状态。 */
  updateStep(input: UpdateWorkflowStepInput): Promise<WorkflowRun>

  /**
   * 把服务端返回的结果写回目标步骤。
   * 目标 Revision 已被重启取代时丢弃该结果，不写入新的执行线。
   */
  applyServerResult(input: ApplyServerResultInput): Promise<WorkflowRun>

  /**
   * 从历史步骤开出新的执行线。
   * 旧 Revision 保留为只读历史，不会被改写成失败或完成。
   */
  restartFromStep(input: RestartWorkflowFromStepInput): Promise<WorkflowRun>

  /** 用户主动停止自动推进；历史保留，不等于失败或完成。 */
  interrupt(): Promise<WorkflowRun>
}
