/** Playtest 对某个动作保存的当前核验结论，不属于资产或创作历史。 */
export type PlaytestInspectionStatus = 'passed' | 'issues_found'

export interface PlaytestInspectionTarget {
  characterId: string
  outfitId: string
  actionId: string
}

export interface PlaytestInspection extends PlaytestInspectionTarget {
  id: string
  status: PlaytestInspectionStatus
  createdAt: string
  updatedAt: string
}

export interface SavePlaytestInspectionInput extends PlaytestInspectionTarget {
  status: PlaytestInspectionStatus
}

export interface PlaytestInspectionApis {
  get(target: PlaytestInspectionTarget): Promise<PlaytestInspection | null>
  save(input: SavePlaytestInspectionInput): Promise<PlaytestInspection>
}
