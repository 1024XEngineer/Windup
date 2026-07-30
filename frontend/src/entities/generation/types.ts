/**
 * Generation 业务记录的数据合同。
 *
 * 三种 Generation 对应用户可见的角色母版、动作首帧和完整动画阶段。联合类型使用
 * type 作为判别字段，使调用方在编译期获得对应输入，而无需把所有字段都设为可选。
 */
import type { ActionType } from '../character'

/** 当前已确认的三类生成业务。 */
export type GenerationType = 'character_template' | 'first_frame' | 'complete_animation'
/** Generation 记录的生命周期；具体 Task 状态由 Task 实体单独表达。 */
export type GenerationStatus = 'pending' | 'running' | 'completed' | 'failed'

/** 前端创建和查询的生成业务记录；模型调用细节只存在于后端。 */
export interface Generation {
  /** Generation 业务记录标识。 */
  id: string
  /** 归属 Project，确保 Quick Start 产物也能进入项目资产。 */
  projectId: string
  type: GenerationType
  status: GenerationStatus
  taskId: string | null
  /** 正式结果合同冻结前保持 unknown，禁止调用方在未缩窄类型时直接使用。 */
  result: unknown
  error: string | null
  createdAt: string
  updatedAt: string
}

/** 根据生成类型严格区分必填字段的创建输入。 */
export type CreateGenerationInput =
  | {
      type: 'character_template'
      projectId: string
      prompt: string
      /** 当前页面提交的参考图地址；后续随正式媒体合同调整，不在本 PR 定义上传接口。 */
      referenceImageUrls: readonly string[]
    }
  | {
      type: 'first_frame'
      projectId: string
      characterId: string
      outfitId: string
      actionType: ActionType
      prompt: string | null
    }
  | {
      type: 'complete_animation'
      projectId: string
      characterId: string
      outfitId: string
      actionType: ActionType
      firstFrameUrl: string
      prompt: string | null
    }
