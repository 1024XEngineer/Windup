import type { CharacterSetupStepInput } from '@/entities'

/** 填写角色资料并提交母版生成。 */
export interface CharacterSetupProps {
  projectId: string
  onSubmit(input: CharacterSetupStepInput): void
}
