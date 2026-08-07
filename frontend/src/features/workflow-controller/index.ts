import type { CreateWorkflowRunInput, WorkflowNode, WorkflowRun } from '@/entities'

/** 更新工作流图中某个节点的业务数据。 */
export interface UpdateWorkflowNodeInput {
  nodeId: WorkflowNode['id']
  data: unknown
}

/** 从指定节点重做；旧结果会被覆盖，不创建 Revision。 */
export interface RestartWorkflowFromNodeInput {
  nodeId: WorkflowNode['id']
}

/** 把某次服务端调用的结果写回目标节点。 */
export interface ApplyServerResultInput {
  nodeId: WorkflowNode['id']
  /** 必须仍是目标节点当前关联的任务，防止重做前的晚到结果覆盖新结果。 */
  taskId: string
  result: unknown
}

/**
 * Quick Start 与手动工作流共用的流程推进边界，不含界面。
 * 两套界面共享同一张节点图：手动模式由用户逐个推进，Quick Start 自动连续推进。
 *
 * 节点和边由前端管理；服务端提供生成能力，并原样持久化 WorkflowRun.nodes。
 * 节点能否推进由 dependsOnNodeIds 指向的前置节点状态决定，不依赖数组位置。
 */
export interface WorkflowController {
  /** 初始化一条节点图。 */
  create(input: CreateWorkflowRunInput): Promise<WorkflowRun>

  /** 读取当前维护的完整流程。 */
  getWorkflow(): WorkflowRun

  /** 推进指定节点；无依赖关系的多个 Action 节点可以并行。 */
  advanceNode(nodeId: WorkflowNode['id']): Promise<WorkflowRun>

  /** 连续推进所有当前可用节点到终点，Quick Start 使用。 */
  runToCompletion(): Promise<WorkflowRun>

  /** 更新指定节点的数据；页面不绕过 Controller 直接改流程状态。 */
  updateNode(input: UpdateWorkflowNodeInput): Promise<WorkflowRun>

  /**
   * 把服务端返回的结果写回目标节点。
   * taskId 已不再属于目标节点时丢弃结果，避免旧请求污染重做后的状态。
   */
  applyServerResult(input: ApplyServerResultInput): Promise<WorkflowRun>

  /** 从指定节点重做并覆盖其旧结果；后端不提供 Revision 历史。 */
  restartFromNode(input: RestartWorkflowFromNodeInput): Promise<WorkflowRun>

  /** 用户主动停止自动推进；已完成节点保留，不等于失败或完成。 */
  interrupt(): Promise<WorkflowRun>
}
