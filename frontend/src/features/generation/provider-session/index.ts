/** Provider Session 的前后端接入契约，不保存明文 API Key。 */
export type ProviderCredentialMode = 'client' | 'server'
export type ProviderSessionStatus = 'unconfigured' | 'connecting' | 'ready' | 'failed'

export interface ProviderDescriptor {
  id: string
  name: string
  credentialModes: ProviderCredentialMode[]
  models: string[]
}

export interface ProviderSession {
  id: string
  providerId: string
  model: string
  credentialMode: ProviderCredentialMode
  status: ProviderSessionStatus
  expiresAt: string | null
}
