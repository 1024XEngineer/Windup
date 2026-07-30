import type { WorkflowNode, WorkflowRun } from '@/entities'

/**
 * Quick Start 与手动工作流共用的流程推进边界，不含界面。
 * 两套界面共享同一套流程：手动模式一次推进一步，Quick Start 连续推进到终点。
 *
 * 它维护的核心数据就是 WorkflowRun 里的节点：当前节点指向哪个、节点数据怎么初始化、
 * 需要调用后端时去创建对应的 generation。往后推进和从某节点重开做的是同一类操作，
 * 因此不拆成多个模块，作为一个整体对外提供方法。
 *
 * 节点怎么走由前端决定，后端只负责持久化 WorkflowRun 和提供生成能力。
 */
export interface WorkflowController {
  /** 推进一步：移动当前节点、初始化该节点数据，必要时创建后端 generation。 */
  nextStep(runId: WorkflowRun['id']): Promise<WorkflowRun>

  /** 连续推进到终点，Quick Start 使用。 */
  runToCompletion(runId: WorkflowRun['id']): Promise<WorkflowRun>

  /**
   * 回到指定历史节点并开出新的执行线。
   * 旧 Revision 保留为只读历史，不会被改写成 failed 或 completed。
   */
  restartFrom(input: {
    run: WorkflowRun
    sourceRevisionId: string
    node: WorkflowNode
  }): Promise<WorkflowRun>
}
