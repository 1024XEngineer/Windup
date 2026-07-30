/**
 * Playtest 只读核验记录及其公开 APIs。
 *
 * 核验记录独立于 Character 和 WorkflowRun：它可以指出某个 Outfit 存在问题，但
 * 不能直接改写制作数据。当前类型和接口规模较小，因此集中在一个入口文件中。
 */
/** 核验通过，或发现需要返回制作流程处理的问题。 */
export type PlaytestInspectionStatus = 'passed' | 'issues_found'

/** Playtest 只读核验产生的独立记录，不写入 Character 或 WorkflowRun。 */
export interface PlaytestInspection {
  /** 独立核验记录标识。 */
  id: string
  /** 被核验的 Character。 */
  characterId: string
  /** 被核验的具体 Outfit；不同造型的动作不能混为一次核验。 */
  outfitId: string
  /** 可选来源版本；独立入口打开当前产物时允许为空。 */
  source: { runId: string; revisionId: string } | null
  status: PlaytestInspectionStatus
  createdAt: string
  updatedAt: string
}

/** 保存一次 Playtest 核验结论所需输入。 */
export interface RecordPlaytestInspectionInput {
  characterId: string
  outfitId: string
  source?: { runId: string; revisionId: string } | null
  status: PlaytestInspectionStatus
}

/** Playtest 核验记录对应的服务端 API。 */
export interface PlaytestInspectionAPIs {
  /** 读取指定 Character/Outfit 最近一次核验，没有记录时返回 null。 */
  getLatest(target: { characterId: string; outfitId: string }): Promise<PlaytestInspection | null>
  /** 新增独立核验记录，不覆盖 Character 或 WorkflowRun。 */
  record(input: RecordPlaytestInspectionInput): Promise<PlaytestInspection>
}
