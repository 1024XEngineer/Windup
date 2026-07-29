/** Quick Start 与手动工作流只改变输入方式，共用同一种运行模型。 */
export type WorkflowDriver = 'ai' | 'manual'

/** 创建 WorkflowRun 时要完成的用户意图。 */
export type WorkflowRunPurpose = 'create_character' | 'add_action'

/**
 * MS2 页面节点类型的唯一标准顺序；它不是后端 Workflow 或 Execution 定义。
 * 具体 Revision 已进入执行线的节点顺序由 WorkflowRevision.nodes 的数组位置表达。
 */
export const WORKFLOW_NODE_ORDER = [
  'character-setup',
  'character-template',
  'template-candidate',
  'action-setup',
  'first-frame',
  'complete-animation',
  'review',
  'export',
] as const

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

/**
 * 整次前端页面流程的汇总状态。
 * interrupted 只表示用户主动停止前端自动推进：历史仍保留且可只读查看，它不等于 failed 或 completed。
 * 后端 Task 是否真正停止是独立问题；未来从历史重启成功后，WorkflowRun 可重新进入 active。
 */
export type WorkflowRunStatus = 'active' | 'interrupted' | 'completed' | 'failed'

/** 当前版本在生成阶段的页面汇总状态；素材准备期间为 not_started。 */
export type GenerationStatus = 'not_started' | 'in_progress' | 'completed' | 'failed'

/** 当前版本在导出阶段的页面汇总状态。 */
export type ExportStatus = 'not_exported' | 'exporting' | 'exported' | 'failed'

/**
 * 一个 WorkflowRevision 中已经进入执行线的前端页面节点。
 * 节点自身不重复保存顺序；其在 WorkflowRevision.nodes 中的数组位置就是该版本的执行顺序。
 */
export interface WorkflowNode {
  /** 前端生成的节点 ID；只用于本地编排和页面定位，不发送给后端作为业务 ID。 */
  id: string
  /** 节点所代表的页面阶段。 */
  type: WorkflowNodeType
  /** 前端对该节点可用性或结果的记录。 */
  status: WorkflowNodeStatus
  /** 进入节点时保存的输入快照；具体结构由对应业务能力 Adapter 定义。 */
  input: unknown
  /** 节点完成后的结果或引用；尚无结果时为 null，具体结构不在编排层猜测。 */
  output: unknown
  /** 该节点沿用或依赖的前端节点 ID，用于版本来源追踪，不代表后端执行依赖。 */
  referenceNodeIds: string[]
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
  /**
   * 已进入当前执行线的节点；数组位置是该版本节点顺序的唯一来源。
   * 尚未推进到的后续节点可以不存在；完整节点类型顺序以 WORKFLOW_NODE_ORDER 为准。
   */
  nodes: WorkflowNode[]
  /** 供页面展示和门禁判断使用的生成汇总状态。 */
  generationStatus: GenerationStatus
  /** 供页面展示和门禁判断使用的导出汇总状态。 */
  exportStatus: ExportStatus
  /** 版本创建时间，使用 ISO 8601 字符串。 */
  createdAt: string
}

/**
 * 一次由前端推进的 MS2 页面流程。
 * 它是后端持久化的业务资源；前端通过 WorkflowRunRepository 读写，不依赖本地存储。
 */
export interface WorkflowRun {
  /** 后端返回的运行 ID，用于路由、查询和持久化。 */
  id: string
  /** 本流程所属的后端 Project ID。 */
  projectId: string
  /** 已关联的后端 Character ID；角色尚未创建或确认时为 null。 */
  characterId: string | null
  /** 已有角色加动作时的目标造型；新建角色时为 null。 */
  outfitId: string | null
  /** 本次运行的用户意图，决定可预填内容和初始阶段。 */
  purpose: WorkflowRunPurpose
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

/** 两种入口共享的 WorkflowRun 创建字段。 */
interface CreateWorkflowRunInputBase {
  /** 新流程所属的后端 Project ID。 */
  projectId: string
  /** 选择 Quick Start 或手动编辑入口。 */
  driver: WorkflowDriver
  /** Quick Start 的自然语言需求；提交时会去除首尾空白，空字符串按 null 保存。 */
  prompt?: string
}

/**
 * 创建后端持久化 WorkflowRun 的输入。
 * add_action 分支把已有角色、具体 Outfit、母版和基准帧设为必填，避免创建无法恢复的半成品运行。
 */
export type CreateWorkflowRunInput = CreateWorkflowRunInputBase &
  (
    | {
        /** 从角色资料阶段开始创建新角色。 */
        purpose: 'create_character'
        characterId?: never
        outfitId?: never
        characterTemplateUrl?: never
        baseFrameUrls?: never
      }
    | {
        /** 从动作资料阶段开始，为已有 Outfit 增加动作。 */
        purpose: 'add_action'
        characterId: string
        outfitId: string
        characterTemplateUrl: string
        baseFrameUrls: readonly string[]
      }
  )

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
      /** 同步当前版本的页面导出状态。 */
      kind: 'set-export-status'
      /** 由后端 Export 能力结果映射得到的状态。 */
      status: ExportStatus
    }

/** WorkflowCommand 判别字段的联合类型。 */
export type WorkflowCommandKind = WorkflowCommand['kind']
