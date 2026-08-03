import type { CreateCharacterInput } from '@/entities'

/** 填写角色资料并提交母版生成。 */
export interface CharacterSetupProps {
  projectId: string
  onSubmit(input: CreateCharacterInput): void
}
