/**
 * WorkflowRun Entity 的公开业务模型。
 *
 * 层级关系是 WorkflowRun（一次用户任务） -> WorkflowRevision（一条重做版本）
 * -> WorkflowStep（版本中的一个步骤）。后端 Generation 只是某个步骤引用的异步任务，
 * 不能代替 WorkflowRun；角色和动作是最终资产，也不应嵌进运行历史。
 */

import type { Generation } from '../../generation'
import type { ActionType } from '../../character'
import {
  EXPORT_STATUSES,
  GENERATION_STATUSES,
  WORKFLOW_DRIVERS,
  WORKFLOW_PURPOSES,
  WORKFLOW_REVISION_STATUSES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_ORDERS,
  WORKFLOW_STEP_STATUSES,
} from './constants'

export {
  ACTION_FIRST_FRAME_CANDIDATE_COUNT,
  CHARACTER_CANDIDATE_COUNT,
  WORKFLOW_STEP_ORDERS,
} from './constants'

/** ai/manual 表示运行由哪种交互方式推进，不改变后端数据契约。 */
export type WorkflowDriver = (typeof WORKFLOW_DRIVERS)[number]

/** Run 的用户目标，也是选择步骤模板和校验资产引用的判别字段。 */
export type WorkflowRunPurpose = (typeof WORKFLOW_PURPOSES)[number]

/** 从两套步骤模板自动推导，避免类型与运行顺序手工维护两份。 */
export type WorkflowStepType =
  (typeof WORKFLOW_STEP_ORDERS)[keyof typeof WORKFLOW_STEP_ORDERS][number]
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number]
export type WorkflowRevisionStatus = (typeof WORKFLOW_REVISION_STATUSES)[number]
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]
export type GenerationStatus = (typeof GENERATION_STATUSES)[number]
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

/**
 * 一次流程步骤的可恢复快照，不包含页面显示状态。
 *
 * 此处故意没有通用 input/output：四张角色候选是后端临时文件，如果把 URL 塞入
 * localStorage，候选删除后就会留下无效历史。可恢复信息通过 taskId、正式资产 ID
 * 和 referenceStepIds 表达，候选预览数组只存在当前界面/请求缓存中。
 */
export interface WorkflowStep {
  /** 前端步骤快照 ID，用于 Revision 之间引用；它不是后端 task ID。 */
  id: string
  /** 步骤业务类型；必须与当前 purpose 对应的模板位置一致。 */
  type: WorkflowStepType
  /** 当前步骤在前端编排中的生命周期。 */
  status: WorkflowStepStatus
  /**
   * 已由后端接受的 Generation ID。步骤 passed/failed 后仍保留，
   * 方便历史查询和问题定位；它只是引用，不复制后端生成结果。
   */
  taskId: Generation['id'] | null
  /**
   * `first-frame` 一次需要 4 个独立生成任务，所以单独保存它们的 ID。
   * 其他步骤必须保持空数组；候选图 URL 仍不进入快照。
   */
  candidateTaskIds: Generation['id'][]
  /**
   * 请求已发出、但后端 taskId 尚未返回时的本地防重标识。
   * taskId 返回后必须清空，两者不能同时存在。
   */
  submissionId: string | null
  /** 失败步骤必须提供原因，其他状态必须为 null。 */
  error: string | null
  /** 新版本沿用的历史步骤，用于解释版本来源。 */
  referenceStepIds: string[]
}

/**
 * 一条可回看的任务执行版本。
 *
 * 用户目标不变，只是从某个已通过步骤重做时，在同一 Run 下追加 Revision。
 * 网络重试不创建 Revision；用户改成另一个动作目标时则创建新 Run。
 */
export interface WorkflowRevision {
  /** 本版本 ID。 */
  id: string
  /** 首版为 null；重做版本指向它沿用的旧 Revision。 */
  basedOnRevisionId: string | null
  /** 首版为 null；重做时记录从旧 Revision 的哪个 passed 步骤重开。 */
  restartStepId: string | null
  status: WorkflowRevisionStatus
  steps: WorkflowStep[]
  generationStatus: GenerationStatus
  exportStatus: ExportStatus
  createdAt: string
}

/**
 * 两种任务共享的运行字段。
 * Run 是历史列表的主体；Revision 是 Run 内部的重做记录，不单独伪装成新任务。
 */
interface WorkflowRunBase {
  /** 一次用户任务的稳定 ID，重做时不变。 */
  id: string
  /** 所属项目；历史记录和恢复查询均按项目隔离。 */
  projectId: string
  driver: WorkflowDriver
  status: WorkflowRunStatus
  /** 当前可继续编辑的版本，必须存在于 revisions 中。 */
  currentRevisionId: string
  /** 按创建时间排列；历史版本只读，重开时追加新版本。 */
  revisions: WorkflowRevision[]
  /** 用户本次任务的目标描述；界面文案不存在这里。 */
  prompt: string | null
  /** Run 创建时间，用于历史排序。 */
  createdAt: string
  /** 任何可持久业务状态最后更新的时间。 */
  updatedAt: string
}

/**
 * 一次前端创作任务。当前由前端推进并用 localStorage 恢复，不伪装成已有后端持久化。
 *
 * create_character 的两个分支表达同一个生命周期：生成中时还没有正式资产 ID；
 * 用户从 4 张候选中选择 1 张且后端保存成功后，才同时写入 characterId、
 * outfitId 和 selectedAt。其余 3 张由后端清理，不进入 WorkflowRun。
 *
 * add_action 是另一个 Run，只在用户点击“生成动作”时创建，
 * 因此必须从开始就绑定已有 characterId 和 outfitId。它会先生成
 * 4 个独立首帧任务，用户选中 1 张后才进入完整动画生成。
 */
export type WorkflowRun = WorkflowRunBase &
  (
    | {
        purpose: 'create_character'
        characterId: null
        outfitId: null
        selectedAt: null
        actionName?: never
        actionType?: never
        actionId?: never
        fps?: never
      }
    | {
        purpose: 'create_character'
        characterId: string
        outfitId: string
        /** 选中图片已保存为正式角色资产的时间。 */
        selectedAt: string
        actionName?: never
        actionType?: never
        actionId?: never
        fps?: never
      }
    | {
        purpose: 'add_action'
        characterId: string
        outfitId: string
        selectedAt?: never
        /** Run 创建时就固定的动作资产 ID，保证审核/发布重试幂等。 */
        actionId: string
        /** 用户这次要创建的动作名称，刷新后仍用于正式写入资产。 */
        actionName: string
        /** 动作的业务语义，不由生成结果反向猜测。 */
        actionType: ActionType
        /** 最终动作资产的默认播放帧率。 */
        fps: number
      }
  )

interface CreateWorkflowRunInputBase {
  /** 任务所属项目，不允许空字符串。 */
  projectId: string
  /** 由 Quick Start 自动推进，或由工作流编辑器手动推进。 */
  driver: WorkflowDriver
  /** 用户任务描述；Store 会去掉首尾空白，空文本按 null 保存。 */
  prompt?: string
}

/**
 * 创建 Run 的判别联合输入。
 *
 * 创建角色时尚无资产 ID，所以类型明确禁止传入 characterId/outfitId；
 * 追加动作必须定位已有角色的具体造型，所以两个 ID 缺一不可。
 */
export type CreateWorkflowRunInput = CreateWorkflowRunInputBase &
  (
    | {
        purpose: 'create_character'
        characterId?: never
        outfitId?: never
        actionName?: never
        actionType?: never
        actionId?: never
        fps?: never
      }
    | {
        purpose: 'add_action'
        characterId: string
        outfitId: string
        actionName: string
        actionType: ActionType
        fps: number
      }
  )
