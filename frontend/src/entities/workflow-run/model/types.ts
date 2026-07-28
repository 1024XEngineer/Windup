/** Quick Start 与手动工作流只改变输入方式，共用同一种运行模型。 */
export type WorkflowDriver = 'ai' | 'manual'

/** MS2 页面节点的固定展示顺序；它不是后端 Workflow 或 Execution 定义。 */
export const WORKFLOW_NODE_ORDER = ['asset', 'generation', 'candidate', 'review', 'export'] as const

/** 前端页面节点类型，与 WORKFLOW_NODE_ORDER 的成员保持一致。 */
export type WorkflowNodeType = (typeof WORKFLOW_NODE_ORDER)[number]

/**
 * 前端节点的可用性和执行结果；不直接复用后端任务状态。
 * locked/available 表示尚未执行，active 表示当前页面阶段，passed/failed 表示本地结果。
 */
export type WorkflowNodeStatus = 'locked' | 'available' | 'active' | 'passed' | 'failed'

/**
 * 单个前端版本的生命周期。
 * active 表示仍在推进，completed/failed 表示终态，abandoned 表示停止沿用但仍保留为历史。
 */
export type WorkflowRevisionStatus = 'active' | 'completed' | 'failed' | 'abandoned'

/** 整次前端页面流程的汇总状态：进行中、已完成或失败。 */
export type WorkflowRunStatus = 'active' | 'completed' | 'failed'

/** 当前版本在生成阶段的页面汇总状态，不等同于后端 Generation Task 状态。 */
export type GenerationStatus = 'in_progress' | 'completed' | 'failed'

/** 当前版本在导出阶段的页面汇总状态。 */
export type ExportStatus = 'not_exported' | 'exporting' | 'exported' | 'failed'

/** 当前版本的人工核验结论；发现问题不会自动阻断导出。 */
export type PlaytestStatus = 'not_tested' | 'passed' | 'issues_found'

/** 一个 WorkflowRevision 中已经进入执行线的前端页面节点。 */
export interface WorkflowNode {
  /** 前端生成的节点 ID；只用于本地编排和页面定位，不发送给后端作为业务 ID。 */
  id: string
  /** 节点所代表的页面阶段。 */
  type: WorkflowNodeType
  /** 节点在当前版本中的零基顺序，正常情况下与 nodes 数组位置一致。 */
  order: number
  /** 前端对该节点可用性或结果的记录。 */
  status: WorkflowNodeStatus
  /** 进入节点时保存的输入快照；具体结构由对应业务能力 Adapter 定义。 */
  input: unknown
  /** 节点完成后的结果或引用；尚无结果时为 null，具体结构不在编排层猜测。 */
  output: unknown
  /** 该节点沿用或依赖的前端节点 ID，用于版本来源追踪，不代表后端执行依赖。 */
  referenceNodeIds: string[]
  /** 系统质检连续失败次数；只对 candidate 节点有业务意义，其他节点保持 0。 */
  qualityFailureCount: number
}

/** WorkflowRun 的一次页面执行版本；当前版本会推进，从旧节点重开则追加新版本。 */
export interface WorkflowRevision {
  /** 前端生成的版本 ID。 */
  id: string
  /** 来源版本 ID；首次创建的版本没有来源，因此为 null。 */
  basedOnRevisionId: string | null
  /** 在来源版本中选择的重启节点 ID；非重启创建的版本为 null。 */
  restartNodeId: string | null
  /** 该版本的前端生命周期状态。 */
  status: WorkflowRevisionStatus
  /** 已进入当前执行线的节点；尚未推进到的后续节点可以不存在。 */
  nodes: WorkflowNode[]
  /** 供页面展示和门禁判断使用的生成汇总状态。 */
  generationStatus: GenerationStatus
  /** 供页面展示和门禁判断使用的导出汇总状态。 */
  exportStatus: ExportStatus
  /** 核验台针对该版本保存的人工结论。 */
  playtestStatus: PlaytestStatus
  /** 版本创建时间，使用 ISO 8601 字符串。 */
  createdAt: string
}

/** 一次由前端维护的 MS2 页面流程；后端不存在同名资源。 */
export interface WorkflowRun {
  /** 前端生成的运行 ID，用于路由和本地持久化。 */
  id: string
  /** 本流程所属的后端 Project ID。 */
  projectId: string
  /** 已关联的后端 Character ID；角色尚未创建或确认时为 null。 */
  characterId: string | null
  /** 启动流程的交互入口：自然语言 Quick Start 或手动编辑器。 */
  driver: WorkflowDriver
  /** 当前运行的前端汇总状态。 */
  status: WorkflowRunStatus
  /** 当前可编辑版本 ID；必须能在 revisions 中找到。 */
  currentRevisionId: string
  /** 按创建顺序保存的全部版本；历史版本保留用于只读查看和重启。 */
  revisions: WorkflowRevision[]
  /** Quick Start 的规范化提示词；空白输入或手动模式无提示词时为 null。 */
  prompt: string | null
}

/** 创建前端 WorkflowRun 所需的最小输入。 */
export interface CreateWorkflowRunInput {
  /** 新流程所属的后端 Project ID。 */
  projectId: string
  /** 选择 Quick Start 或手动编辑入口。 */
  driver: WorkflowDriver
  /** Quick Start 的自然语言需求；提交时会去除首尾空白，空字符串按 null 保存。 */
  prompt?: string
}

/**
 * 驱动前端页面编排状态变化的命令。
 * 真实生成、审核和导出结果应先由对应后端能力返回，再转换成这里的本地命令。
 */
export type WorkflowCommand =
  | {
      /** 将当前活动节点标记为完成并推进到下一页面节点。 */
      kind: 'complete-node'
      /** 当前版本中要完成的节点 ID。 */
      nodeId: string
      /** 对应业务能力返回的结果或引用；编排层不限定具体结构。 */
      output?: unknown
    }
  | {
      /** 将当前活动节点和所在版本标记为失败。 */
      kind: 'fail-node'
      /** 当前版本中失败的节点 ID。 */
      nodeId: string
      /** 可展示或记录的失败原因，不承载结构化后端错误对象。 */
      error: string
    }
  | {
      /** 记录 candidate 节点的一次系统质检结果。 */
      kind: 'record-quality-result'
      /** 当前版本中的 candidate 节点 ID。 */
      nodeId: string
      /** 是否通过本次系统质检。 */
      passed: boolean
      /** 后端 Review 能力返回的质检报告；契约冻结前保持 unknown。 */
      report?: unknown
    }
  | {
      /** 从历史版本的某个节点创建一个新版本。 */
      kind: 'restart-from-node'
      /** 被选作来源的历史版本 ID。 */
      sourceRevisionId: string
      /** 来源版本中作为新执行起点的节点 ID。 */
      nodeId: string
    }
  | {
      /** 同步当前版本的页面导出状态。 */
      kind: 'set-export-status'
      /** 由后端 Export 能力结果映射得到的状态。 */
      status: ExportStatus
    }
  | {
      /** 保存核验台针对指定版本的人工结论。 */
      kind: 'record-playtest'
      /** 被核验的版本 ID，不要求是当前可编辑版本。 */
      revisionId: string
      /** 已作出的核验结论；未核验状态不能作为提交值。 */
      status: Exclude<PlaytestStatus, 'not_tested'>
    }

/** WorkflowCommand 判别字段的联合类型。 */
export type WorkflowCommandKind = WorkflowCommand['kind']

/** 跨页面恢复编辑位置时使用的前端定位信息。 */
export interface WorkflowLocation {
  /** 要打开的 WorkflowRun ID。 */
  runId: string
  /** 要查看或编辑的版本 ID。 */
  revisionId: string
  /** 要聚焦的页面节点 ID。 */
  nodeId: string
  /** 可选的 Action ID；只有需要定位到具体动作时提供。 */
  actionId?: string
  /** Action.frames 中的零基索引；只有需要定位到具体帧时提供。 */
  frameIndex?: number
}
