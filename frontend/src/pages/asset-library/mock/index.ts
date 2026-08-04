import type {
  CharacterApis,
  ActionTemplateApis,
  CreateCharacterInput,
  CreateProjectInput,
  ProjectApis,
  UpdateProjectInput,
} from '@/entities'

import { mockActionTemplates, mockCharacters, mockProjects } from './fixtures'

function unavailable(operation: string): Promise<never> {
  return Promise.reject(new Error(`${operation} is unavailable in the asset hierarchy validation`))
}

export const mockProjectApis: ProjectApis = {
  async list(query = {}) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20

    return {
      items: mockProjects.slice((page - 1) * pageSize, page * pageSize),
      total: mockProjects.length,
      page,
      pageSize,
    }
  },
  async get(id) {
    const project = mockProjects.find((item) => item.id === id)
    if (!project) throw new Error(`Project ${id} not found`)
    return project
  },
  create(_input: CreateProjectInput) {
    return unavailable('ProjectApis.create')
  },
  update(_id: string, _input: UpdateProjectInput) {
    return unavailable('ProjectApis.update')
  },
  remove(_id: string) {
    return unavailable('ProjectApis.remove')
  },
}

export const mockCharacterApis: CharacterApis = {
  async get(id) {
    const character = mockCharacters.find((item) => item.id === id)
    if (!character) throw new Error(`Character ${id} not found`)
    return character
  },
  async listByProject(projectId) {
    return mockCharacters.filter((character) => character.projectId === projectId)
  },
  create(_input: CreateCharacterInput) {
    return unavailable('CharacterApis.create')
  },
  update(_character) {
    return unavailable('CharacterApis.update')
  },
}

export const mockActionTemplateApis: ActionTemplateApis = {
  async listAvailable(projectId) {
    return mockActionTemplates.filter(
      (template) => template.scope === 'system' || template.projectId === projectId,
    )
  },
}

export { ExtractedAssetsProvider } from './extracted-assets'
export {
  useExtractedAssets,
  type ExtractedAsset,
  type ExtractedAssetKind,
} from './extracted-assets-context'
