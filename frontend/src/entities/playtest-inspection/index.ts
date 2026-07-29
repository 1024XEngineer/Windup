/** 可持久化的 Playtest 核验结论；没有记录即表示尚未核验。 */
export type PlaytestInspectionStatus = 'passed' | 'issues_found'

/** 一次独立核验记录，不属于 Character 或 WorkflowRevision 的内部字段。 */
export interface PlaytestInspection {
  id: string
  characterId: string
  outfitId: string
  /** 仅从 Workflow 进入时保留返回定位；独立入口为 null。 */
  source: { runId: string; revisionId: string } | null
  status: PlaytestInspectionStatus
  createdAt: string
  updatedAt: string
}

/** 创建或更新指定核验目标结论所需的业务输入。 */
export interface RecordPlaytestInspectionInput {
  characterId: string
  outfitId: string
  /** 可选的 Workflow 来源，不是播放和核验的前置条件。 */
  source?: { runId: string; revisionId: string } | null
  status: PlaytestInspectionStatus
}

/** 独立核验记录的异步存取边界；Preview 有同契约内存实现，Production 等待真实端点。 */
export interface PlaytestInspectionRepository {
  getLatest(target: { characterId: string; outfitId: string }): Promise<PlaytestInspection | null>
  record(input: RecordPlaytestInspectionInput): Promise<PlaytestInspection>
}
