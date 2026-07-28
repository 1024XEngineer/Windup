/**
 * Provider Session 的凭据来源。
 * client 表示浏览器临时提交，server 表示服务端预先配置；两者都不在前端持久化明文 API Key。
 */
export type ProviderCredentialMode = 'client' | 'server'

/**
 * 前端展示的 Provider Session 连接状态。
 * unconfigured 尚未配置，connecting 正在连接，ready 可用，failed 连接失败；最终值以后端契约为准。
 */
export type ProviderSessionStatus = 'unconfigured' | 'connecting' | 'ready' | 'failed'

/** 后端声明的一个可用 AI Provider 及其能力。 */
export interface ProviderDescriptor {
  /** 后端稳定的 Provider 标识，用于创建会话。 */
  id: string
  /** 面向用户展示的 Provider 名称。 */
  name: string
  /** 该 Provider 允许使用的凭据提供方式。 */
  credentialModes: ProviderCredentialMode[]
  /** 后端允许选择的模型标识列表。 */
  models: string[]
}

/** 后端创建的临时 Provider 连接会话；不包含 API Key。 */
export interface ProviderSession {
  /** 后端生成的会话 ID，供 Generation 请求引用。 */
  id: string
  /** 会话连接的 ProviderDescriptor.id。 */
  providerId: string
  /** 本次会话选定的模型标识。 */
  model: string
  /** 本次会话采用的凭据提供方式。 */
  credentialMode: ProviderCredentialMode
  /** 会话当前连接状态。 */
  status: ProviderSessionStatus
  /** 会话过期时间，预期为 ISO 8601；不会过期或后端未提供时为 null。 */
  expiresAt: string | null
}
