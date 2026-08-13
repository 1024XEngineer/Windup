import type { Character, Project } from '@/entities'

import type { ExportPackageModel } from './model'
import { createProgressiveExportModel } from './progressive-export'

export interface CreateCharacterExportModelInput {
  project: Project
  character: Character
  outfitId: string
}

export function createCharacterExportModel({
  project,
  character,
  outfitId,
}: CreateCharacterExportModelInput): ExportPackageModel {
  return createProgressiveExportModel({ project, character, outfitId })
}
